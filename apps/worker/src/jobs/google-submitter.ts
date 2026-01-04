import { Job, Worker } from 'bullmq';
import { google } from 'googleapis';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { db } from '@repo/db';
import { urls, submissions, credentials, quotaUsage, projects } from '@repo/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { metrics } from '../lib/metrics';
import { decryptCredentials } from '../lib/encryption';

// ============ TYPES ============
interface GoogleSubmitterPayload {
  projectId: string;
  jobId: string;
  urlIds: string[];
  action: 'URL_UPDATED' | 'URL_DELETED';
}

interface SubmissionResult {
  urlId: string;
  success: boolean;
  responseCode?: number;
  error?: string;
}

// ============ CONFIGURATION ============
const CONFIG = {
  DAILY_QUOTA: 200, // Google's default quota
  BATCH_SIZE: 100, // Max URLs per batch request
  CONCURRENT_REQUESTS: 5,
  RATE_LIMIT_DELAY_MS: 1000,
  MAX_RETRIES: 3,
};

// ============ WORKER ============
export const googleSubmitterWorker = new Worker<GoogleSubmitterPayload>(
  'google-submitter',
  async (job: Job<GoogleSubmitterPayload>) => {
    const { projectId, jobId, urlIds, action } = job.data;
    const startTime = Date.now();
    
    logger.info({ jobId, projectId, urlCount: urlIds.length, action }, 'Starting Google submission');
    
    try {
      // Get project credentials
      const [credential] = await db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.projectId, projectId),
            eq(credentials.engine, 'GOOGLE')
          )
        )
        .limit(1);
      
      if (!credential) {
        throw new Error('Google credentials not configured for this project');
      }
      
      // Decrypt service account JSON
      const serviceAccountJson = decryptCredentials(
        credential.encryptedData,
        credential.iv,
        credential.authTag
      );
      const serviceAccount = JSON.parse(serviceAccountJson);
      
      // Create authenticated client
      const auth = new google.auth.GoogleAuth({
        credentials: serviceAccount,
        scopes: ['https://www.googleapis.com/auth/indexing'],
      });
      
      const indexing = google.indexing({ version: 'v3', auth });
      
      // Check quota
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const [quota] = await db
        .select()
        .from(quotaUsage)
        .where(
          and(
            eq(quotaUsage.projectId, projectId),
            eq(quotaUsage.engine, 'GOOGLE'),
            eq(quotaUsage.date, today)
          )
        )
        .limit(1);
      
      const currentUsage = quota?.used ?? 0;
      const remainingQuota = CONFIG.DAILY_QUOTA - currentUsage;
      
      if (remainingQuota <= 0) {
        throw new Error('Daily Google Indexing API quota exhausted');
      }
      
      // Limit URLs to remaining quota
      const urlsToSubmit = urlIds.slice(0, remainingQuota);
      
      if (urlsToSubmit.length < urlIds.length) {
        logger.warn({
          requested: urlIds.length,
          submitting: urlsToSubmit.length,
          reason: 'quota_limit',
        }, 'Truncated submission due to quota');
      }
      
      // Get URL records
      const urlRecords = await db
        .select({ id: urls.id, loc: urls.loc })
        .from(urls)
        .where(inArray(urls.id, urlsToSubmit));
      
      // Submit URLs with rate limiting
      const limiter = pLimit(CONFIG.CONCURRENT_REQUESTS);
      const results: SubmissionResult[] = [];
      
      for (const urlRecord of urlRecords) {
        const result = await limiter(async () => {
          return submitSingleUrl(indexing, urlRecord, action);
        });
        
        results.push(result);
        
        // Update progress
        const progress = Math.round((results.length / urlRecords.length) * 100);
        await job.updateProgress(progress);
        
        // Rate limit delay
        await new Promise(r => setTimeout(r, CONFIG.RATE_LIMIT_DELAY_MS / CONFIG.CONCURRENT_REQUESTS));
      }
      
      // Record submissions in database
      const successCount = results.filter(r => r.success).length;
      const failCount = results.filter(r => !r.success).length;
      
      // Batch insert submission records
      const submissionRecords = results.map(result => ({
        urlId: result.urlId,
        projectId,
        engine: 'GOOGLE' as const,
        action,
        status: result.success ? ('COMPLETED' as const) : ('FAILED' as const),
        responseCode: result.responseCode,
        errorMessage: result.error,
        completedAt: new Date(),
      }));
      
      await db.insert(submissions).values(submissionRecords);
      
      // Update URL statuses
      const successfulIds = results.filter(r => r.success).map(r => r.urlId);
      if (successfulIds.length > 0) {
        await db
          .update(urls)
          .set({
            googleStatus: 'SUBMITTED',
            googleSubmittedAt: new Date(),
          })
          .where(inArray(urls.id, successfulIds));
      }
      
      // Update quota usage
      await db
        .insert(quotaUsage)
        .values({
          projectId,
          engine: 'GOOGLE',
          date: today,
          used: successCount,
          limit: CONFIG.DAILY_QUOTA,
        })
        .onConflictDoUpdate({
          target: [quotaUsage.projectId, quotaUsage.engine, quotaUsage.date],
          set: {
            used: sql`${quotaUsage.used} + ${successCount}`,
          },
        });
      
      // Metrics
      const duration = Date.now() - startTime;
      metrics.counter('google_submissions_total', successCount, { status: 'success' });
      metrics.counter('google_submissions_total', failCount, { status: 'failed' });
      metrics.histogram('google_submission_duration_ms', duration);
      
      logger.info({
        jobId,
        successCount,
        failCount,
        duration,
      }, 'Google submission completed');
      
      return { successCount, failCount, duration };
      
    } catch (error) {
      logger.error({ jobId, projectId, error }, 'Google submission failed');
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 5,
    limiter: {
      max: 10,
      duration: 1000,
    },
  }
);

// ============ SINGLE URL SUBMISSION ============
async function submitSingleUrl(
  indexing: any,
  urlRecord: { id: string; loc: string },
  action: 'URL_UPDATED' | 'URL_DELETED'
): Promise<SubmissionResult> {
  try {
    const response = await pRetry(
      async () => {
        const res = await indexing.urlNotifications.publish({
          requestBody: {
            url: urlRecord.loc,
            type: action,
          },
        });
        return res;
      },
      {
        retries: CONFIG.MAX_RETRIES,
        onFailedAttempt: (error) => {
          logger.warn({
            url: urlRecord.loc,
            attempt: error.attemptNumber,
            error: error.message,
          }, 'Google API retry');
        },
      }
    );
    
    return {
      urlId: urlRecord.id,
      success: true,
      responseCode: response.status,
    };
    
  } catch (error: any) {
    const statusCode = error.response?.status ?? error.code;
    
    // Handle specific error codes
    if (statusCode === 429) {
      logger.warn({ url: urlRecord.loc }, 'Rate limited by Google');
    } else if (statusCode === 403) {
      logger.error({ url: urlRecord.loc }, 'Permission denied - check Search Console verification');
    }
    
    return {
      urlId: urlRecord.id,
      success: false,
      responseCode: statusCode,
      error: error.message,
    };
  }
}

export default googleSubmitterWorker;
