import { Job, Worker } from 'bullmq';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';
import sax from 'sax';
import pRetry from 'p-retry';
import pLimit from 'p-limit';
import { db } from '@repo/db';
import { projects, sitemaps, urls, jobs } from '@repo/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { logger } from '../lib/logger';
import { redis } from '../lib/redis';
import { metrics } from '../lib/metrics';

// ============ TYPES ============
interface SitemapScannerPayload {
  projectId: string;
  jobId: string;
  sitemapUrl?: string; // If not provided, use project's main sitemap
  isIndex?: boolean;
  parentSitemapId?: string;
  depth?: number;
}

interface ParsedUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

// ============ CONFIGURATION ============
const CONFIG = {
  MAX_RECURSION_DEPTH: 10,
  BATCH_SIZE: 500, // URLs to insert per batch
  CONCURRENT_SITEMAP_FETCHES: 5,
  FETCH_TIMEOUT_MS: 60000,
  MAX_RETRIES: 3,
  USER_AGENT: 'SitemapIndexerPro/2.0 (Enterprise Edition; +https://indexerpro.io/bot)',
};

// ============ WORKER ============
export const sitemapScannerWorker = new Worker<SitemapScannerPayload>(
  'sitemap-scanner',
  async (job: Job<SitemapScannerPayload>) => {
    const { projectId, jobId, sitemapUrl, isIndex, parentSitemapId, depth = 0 } = job.data;
    const startTime = Date.now();
    
    logger.info({ jobId, projectId, sitemapUrl, depth }, 'Starting sitemap scan');
    
    try {
      // Get project details
      const [project] = await db
        .select()
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      
      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }
      
      const targetUrl = sitemapUrl || project.sitemapUrl;
      
      // Update job status
      await db
        .update(jobs)
        .set({ status: 'PROCESSING', startedAt: new Date() })
        .where(eq(jobs.id, jobId));
      
      // Fetch and parse sitemap
      const { type, urls: parsedUrls, childSitemaps } = await fetchAndParseSitemap(targetUrl);
      
      logger.info({ 
        jobId, 
        type, 
        urlCount: parsedUrls.length, 
        childCount: childSitemaps.length 
      }, 'Sitemap parsed successfully');
      
      // Store/update sitemap record
      const [sitemapRecord] = await db
        .insert(sitemaps)
        .values({
          projectId,
          url: targetUrl,
          type,
          parentId: parentSitemapId,
          urlCount: parsedUrls.length,
          lastFetchedAt: new Date(),
          contentHash: createHash('sha256').update(JSON.stringify(parsedUrls)).digest('hex'),
        })
        .onConflictDoUpdate({
          target: [sitemaps.projectId, sitemaps.url],
          set: {
            urlCount: parsedUrls.length,
            lastFetchedAt: new Date(),
            contentHash: createHash('sha256').update(JSON.stringify(parsedUrls)).digest('hex'),
          },
        })
        .returning();
      
      // Batch upsert URLs
      if (parsedUrls.length > 0) {
        await batchUpsertUrls(projectId, sitemapRecord.id, parsedUrls, job);
      }
      
      // Recursively process child sitemaps (for sitemap index files)
      if (childSitemaps.length > 0 && depth < CONFIG.MAX_RECURSION_DEPTH) {
        const limiter = pLimit(CONFIG.CONCURRENT_SITEMAP_FETCHES);
        
        await Promise.all(
          childSitemaps.map(childUrl =>
            limiter(() =>
              job.queue?.add('sitemap-scanner', {
                projectId,
                jobId, // Same parent job ID for tracking
                sitemapUrl: childUrl,
                isIndex: false,
                parentSitemapId: sitemapRecord.id,
                depth: depth + 1,
              })
            )
          )
        );
        
        logger.info({ jobId, childCount: childSitemaps.length }, 'Queued child sitemaps');
      }
      
      // Update project stats
      await updateProjectStats(projectId);
      
      // Complete job only if this is the root sitemap
      if (depth === 0) {
        await db
          .update(jobs)
          .set({ 
            status: 'COMPLETED', 
            completedAt: new Date(),
            progress: 100,
          })
          .where(eq(jobs.id, jobId));
      }
      
      // Metrics
      const duration = Date.now() - startTime;
      metrics.histogram('sitemap_scan_duration_ms', duration, { type });
      metrics.counter('urls_discovered_total', parsedUrls.length, { projectId });
      
      return {
        urlCount: parsedUrls.length,
        childSitemapCount: childSitemaps.length,
        duration,
      };
      
    } catch (error) {
      logger.error({ jobId, projectId, error }, 'Sitemap scan failed');
      
      await db
        .update(jobs)
        .set({ 
          status: 'FAILED', 
          completedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        })
        .where(eq(jobs.id, jobId));
      
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 10,
    limiter: {
      max: 50,
      duration: 1000, // 50 jobs per second
    },
  }
);

// ============ FETCH & PARSE ============
async function fetchAndParseSitemap(url: string): Promise<{
  type: 'INDEX' | 'URLSET';
  urls: ParsedUrl[];
  childSitemaps: string[];
}> {
  const response = await pRetry(
    async () => {
      const res = await fetch(url, {
        headers: {
          'User-Agent': CONFIG.USER_AGENT,
          'Accept': 'application/xml, text/xml, */*',
          'Accept-Encoding': 'gzip, deflate',
        },
        signal: AbortSignal.timeout(CONFIG.FETCH_TIMEOUT_MS),
      });
      
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      
      return res;
    },
    {
      retries: CONFIG.MAX_RETRIES,
      onFailedAttempt: (error) => {
        logger.warn({ url, attempt: error.attemptNumber, error: error.message }, 'Fetch retry');
      },
    }
  );
  
  // Get response body as stream
  const contentEncoding = response.headers.get('content-encoding');
  let bodyStream: ReadableStream<Uint8Array> | null = response.body;
  
  if (!bodyStream) {
    throw new Error('Empty response body');
  }
  
  // Handle gzip decompression
  if (contentEncoding === 'gzip' || url.endsWith('.gz')) {
    const nodeStream = Readable.fromWeb(bodyStream as any);
    const gunzip = createGunzip();
    bodyStream = Readable.toWeb(nodeStream.pipe(gunzip)) as ReadableStream<Uint8Array>;
  }
  
  // SAX streaming parser
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    const urls: ParsedUrl[] = [];
    const childSitemaps: string[] = [];
    let currentUrl: Partial<ParsedUrl> = {};
    let currentTag = '';
    let isIndex = false;
    
    parser.on('opentag', (node) => {
      currentTag = node.name.toLowerCase();
      if (currentTag === 'sitemapindex') {
        isIndex = true;
      }
    });
    
    parser.on('text', (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      
      switch (currentTag) {
        case 'loc':
          if (isIndex) {
            childSitemaps.push(trimmed);
          } else {
            currentUrl.loc = trimmed;
          }
          break;
        case 'lastmod':
          currentUrl.lastmod = trimmed;
          break;
        case 'changefreq':
          currentUrl.changefreq = trimmed;
          break;
        case 'priority':
          currentUrl.priority = trimmed;
          break;
      }
    });
    
    parser.on('closetag', (name) => {
      if (name.toLowerCase() === 'url' && currentUrl.loc) {
        urls.push(currentUrl as ParsedUrl);
        currentUrl = {};
      }
      currentTag = '';
    });
    
    parser.on('error', reject);
    parser.on('end', () => {
      resolve({
        type: isIndex ? 'INDEX' : 'URLSET',
        urls,
        childSitemaps,
      });
    });
    
    // Pipe the stream through the parser
    const reader = bodyStream!.getReader();
    const decoder = new TextDecoder();
    
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            parser.end();
            break;
          }
          parser.write(decoder.decode(value, { stream: true }));
        }
      } catch (error) {
        reject(error);
      }
    })();
  });
}

// ============ BATCH UPSERT ============
async function batchUpsertUrls(
  projectId: string,
  sitemapId: string,
  parsedUrls: ParsedUrl[],
  job: Job
): Promise<void> {
  const total = parsedUrls.length;
  let processed = 0;
  
  for (let i = 0; i < total; i += CONFIG.BATCH_SIZE) {
    const batch = parsedUrls.slice(i, i + CONFIG.BATCH_SIZE);
    
    const values = batch.map(url => ({
      projectId,
      sitemapId,
      loc: url.loc,
      locHash: createHash('sha256').update(url.loc).digest('hex'),
      lastmod: url.lastmod ? new Date(url.lastmod) : null,
      changefreq: url.changefreq,
      priority: url.priority ? parseFloat(url.priority) : null,
    }));
    
    await db
      .insert(urls)
      .values(values)
      .onConflictDoUpdate({
        target: [urls.projectId, urls.locHash],
        set: {
          sitemapId,
          lastmod: sql`EXCLUDED.lastmod`,
          changefreq: sql`EXCLUDED.changefreq`,
          priority: sql`EXCLUDED.priority`,
        },
      });
    
    processed += batch.length;
    
    // Update job progress
    const progress = Math.round((processed / total) * 100);
    await job.updateProgress(progress);
    
    logger.debug({ processed, total, progress }, 'Batch inserted');
  }
}

// ============ UPDATE PROJECT STATS ============
async function updateProjectStats(projectId: string): Promise<void> {
  const stats = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE google_status = 'INDEXED') as indexed,
      COUNT(*) FILTER (WHERE google_status IN ('DISCOVERED', 'QUEUED')) as pending,
      COUNT(*) FILTER (WHERE google_status IN ('ERROR_4XX', 'ERROR_5XX', 'CRAWL_ERROR')) as errors
    FROM urls
    WHERE project_id = ${projectId}
  `);
  
  const { total, indexed, pending, errors } = stats.rows[0] as any;
  
  await db
    .update(projects)
    .set({
      totalUrls: Number(total),
      indexedUrls: Number(indexed),
      pendingUrls: Number(pending),
      errorUrls: Number(errors),
      lastScanAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(projects.id, projectId));
}

// ============ EVENT HANDLERS ============
sitemapScannerWorker.on('completed', (job) => {
  logger.info({ jobId: job.id, data: job.returnvalue }, 'Job completed');
});

sitemapScannerWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error }, 'Job failed');
});

export default sitemapScannerWorker;
