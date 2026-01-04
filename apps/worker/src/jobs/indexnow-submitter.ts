import { Job, Worker } from 'bullmq';
import pLimit from 'p-limit';
import pRetry from 'p-retry';
import { db } from '@repo/db';
import { urls, submissions, credentials, quotaUsage, projects } from '@repo/db/schema';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { metrics } from '../lib/metrics';

// ============ TYPES ============
interface IndexNowPayload {
  projectId: string;
  jobId: string;
  urlIds: string[];
}

interface IndexNowConfig {
  host: string;
  key: string;
  keyLocation: string;
}

// ============ SUPPORTED ENGINES ============
const INDEXNOW_ENDPOINTS = {
  bing: 'https://www.bing.com/indexnow',
  yandex: 'https://yandex.com/indexnow',
  seznam: 'https://search.seznam.cz/indexnow',
  naver: 'https://searchadvisor.naver.com/indexnow',
} as const;

// ============ CONFIGURATION ============
const CONFIG = {
  DAILY_QUOTA: 10000,
  BATCH_SIZE: 10000, // IndexNow supports up to 10K URLs per request
  CONCURRENT_ENGINES: 4,
  REQUEST_TIMEOUT_MS: 30000,
  MAX_RETRIES: 3,
  USER_AGENT: 'SitemapIndexerPro/2.0 (Enterprise; +https://indexerpro.io)',
};

// ============ WORKER ============
export const indexNowSubmitterWorker = new Worker<IndexNowPayload>(
  'indexnow-submitter',
  async (job: Job<IndexNowPayload>) => {
    const { projectId, jobId, urlIds } = job.data;
    const startTime = Date.now();
    
    logger.info({ jobId, projectId, urlCount: urlIds.length }, 'Starting IndexNow submission');
    
    try {
      // Get project and credentials
      const [project] = await db
        .select({
          id: projects.id,
          domain: projects.domain,
        })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
      
      // Get IndexNow key
      const [credential] = await db
        .select()
        .from(credentials)
        .where(
          and(
            eq(credentials.projectId, projectId),
            eq(credentials.engine, 'INDEXNOW')
          )
        )
        .limit(1);
      
      if (!credential) {
        throw new Error('IndexNow key not configured for this project');
      }
      
      // Decrypt the key (IndexNow key is just a string, not JSON)
      const indexNowKey = await decryptSimpleCredential(credential);
      
      const config: IndexNowConfig = {
        host: project.domain,
        key: indexNowKey,
        keyLocation: `https://${project.domain}/${indexNowKey}.txt`,
      };
      
      // Get URL records
      const urlRecords = await db
        .select({ id: urls.id, loc: urls.loc })
        .from(urls)
        .where(inArray(urls.id, urlIds));
      
      const urlList = urlRecords.map(u => u.loc);
      
      // Submit to all IndexNow engines in parallel
      const limiter = pLimit(CONFIG.CONCURRENT_ENGINES);
      const results = await Promise.allSettled(
        Object.entries(INDEXNOW_ENDPOINTS).map(([engine, endpoint]) =>
          limiter(() => submitToEngine(engine, endpoint, urlList, config))
        )
      );
      
      // Process results
      const successfulEngines: string[] = [];
      const failedEngines: string[] = [];
      
      results.forEach((result, index) => {
        const engineName = Object.keys(INDEXNOW_ENDPOINTS)[index];
        if (result.status === 'fulfilled' && result.value.success) {
          successfulEngines.push(engineName);
        } else {
          failedEngines.push(engineName);
          const error = result.status === 'rejected' 
            ? result.reason 
            : result.value.error;
          logger.warn({ engine: engineName, error }, 'IndexNow submission failed for engine');
        }
      });
      
      // Record submissions
      const submissionRecords = urlRecords.map(url => ({
        urlId: url.id,
        projectId,
        engine: 'INDEXNOW' as const,
        action: 'URL_UPDATED',
        status: successfulEngines.length > 0 ? ('COMPLETED' as const) : ('FAILED' as const),
        responseCode: successfulEngines.length > 0 ? 200 : 500,
        metadata: { successfulEngines, failedEngines },
        completedAt: new Date(),
      }));
      
      await db.insert(submissions).values(submissionRecords);
      
      // Update URL statuses
      if (successfulEngines.length > 0) {
        await db
          .update(urls)
          .set({
            bingStatus: 'SUBMITTED',
            bingSubmittedAt: new Date(),
          })
          .where(inArray(urls.id, urlIds));
      }
      
      // Update quota
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      await db
        .insert(quotaUsage)
        .values({
          projectId,
          engine: 'INDEXNOW',
          date: today,
          used: urlIds.length,
          limit: CONFIG.DAILY_QUOTA,
        })
        .onConflictDoUpdate({
          target: [quotaUsage.projectId, quotaUsage.engine, quotaUsage.date],
          set: {
            used: sql`${quotaUsage.used} + ${urlIds.length}`,
          },
        });
      
      // Update job progress
      await job.updateProgress(100);
      
      // Metrics
      const duration = Date.now() - startTime;
      metrics.counter('indexnow_submissions_total', urlIds.length, { 
        status: successfulEngines.length > 0 ? 'success' : 'failed' 
      });
      metrics.histogram('indexnow_submission_duration_ms', duration);
      
      logger.info({
        jobId,
        urlCount: urlIds.length,
        successfulEngines,
        failedEngines,
        duration,
      }, 'IndexNow submission completed');
      
      return {
        urlCount: urlIds.length,
        successfulEngines,
        failedEngines,
        duration,
      };
      
    } catch (error) {
      logger.error({ jobId, projectId, error }, 'IndexNow submission failed');
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 3,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);

// ============ SUBMIT TO SINGLE ENGINE ============
async function submitToEngine(
  engine: string,
  endpoint: string,
  urlList: string[],
  config: IndexNowConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await pRetry(
      async () => {
        // IndexNow accepts both GET (single URL) and POST (batch)
        // We use POST for efficiency
        const body = {
          host: config.host,
          key: config.key,
          keyLocation: config.keyLocation,
          urlList: urlList,
        };
        
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'User-Agent': CONFIG.USER_AGENT,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(CONFIG.REQUEST_TIMEOUT_MS),
        });
        
        // IndexNow returns 200, 202 for success
        // 400 = invalid request, 403 = key not valid, 422 = invalid URL, 429 = rate limit
        if (!res.ok) {
          const errorText = await res.text().catch(() => 'Unknown error');
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        
        return res;
      },
      {
        retries: CONFIG.MAX_RETRIES,
        onFailedAttempt: (error) => {
          logger.warn({
            engine,
            attempt: error.attemptNumber,
            error: error.message,
          }, 'IndexNow retry');
        },
      }
    );
    
    logger.info({ engine, status: response.status }, 'IndexNow submission successful');
    return { success: true };
    
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

// ============ SIMPLE CREDENTIAL DECRYPTION ============
async function decryptSimpleCredential(credential: any): Promise<string> {
  // Import from encryption module
  const { decryptCredentials } = await import('../lib/encryption');
  return decryptCredentials(
    credential.encryptedData,
    credential.iv,
    credential.authTag
  );
}

export default indexNowSubmitterWorker;
