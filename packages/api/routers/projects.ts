import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { createTRPCRouter, protectedProcedure } from '../trpc';
import { projects, urls, sitemaps, jobs } from '@repo/db/schema';
import { eq, and, desc, sql, count } from 'drizzle-orm';
import { createHash } from 'crypto';

// ============ INPUT VALIDATORS ============
const createProjectSchema = z.object({
  name: z.string().min(1).max(255),
  domain: z.string().url().or(z.string().regex(/^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}$/)),
  sitemapUrl: z.string().url(),
  settings: z.object({
    autoSync: z.boolean().default(true),
    syncFrequencyHours: z.number().min(1).max(168).default(24),
    priorityEngines: z.array(z.enum(['GOOGLE', 'BING', 'INDEXNOW'])).default(['GOOGLE', 'INDEXNOW']),
    excludePatterns: z.array(z.string()).default([]),
  }).optional(),
});

const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().uuid(),
});

const listUrlsSchema = z.object({
  projectId: z.string().uuid(),
  status: z.enum(['DISCOVERED', 'QUEUED', 'SUBMITTED', 'INDEXED', 'NOT_INDEXED', 'ERROR']).optional(),
  search: z.string().optional(),
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(50),
  sortBy: z.enum(['loc', 'lastmod', 'googleStatus', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ============ ROUTER ============
export const projectsRouter = createTRPCRouter({
  
  // List all projects for the organization
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const { db, organizationId } = ctx;
      
      const projectList = await db
        .select({
          id: projects.id,
          name: projects.name,
          domain: projects.domain,
          sitemapUrl: projects.sitemapUrl,
          isActive: projects.isActive,
          totalUrls: projects.totalUrls,
          indexedUrls: projects.indexedUrls,
          pendingUrls: projects.pendingUrls,
          errorUrls: projects.errorUrls,
          lastScanAt: projects.lastScanAt,
          lastSubmissionAt: projects.lastSubmissionAt,
          createdAt: projects.createdAt,
        })
        .from(projects)
        .where(eq(projects.organizationId, organizationId))
        .orderBy(desc(projects.createdAt));
      
      return projectList;
    }),

  // Get single project with detailed stats
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      const [project] = await db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.id, input.id),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1);
      
      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }
      
      // Get status breakdown
      const statusBreakdown = await db
        .select({
          status: urls.googleStatus,
          count: count(),
        })
        .from(urls)
        .where(eq(urls.projectId, input.id))
        .groupBy(urls.googleStatus);
      
      // Get recent jobs
      const recentJobs = await db
        .select()
        .from(jobs)
        .where(eq(jobs.projectId, input.id))
        .orderBy(desc(jobs.createdAt))
        .limit(10);
      
      return {
        ...project,
        statusBreakdown: Object.fromEntries(
          statusBreakdown.map(s => [s.status, Number(s.count)])
        ),
        recentJobs,
      };
    }),

  // Create new project
  create: protectedProcedure
    .input(createProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId, userId } = ctx;
      
      // Check for duplicate domain
      const existing = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.organizationId, organizationId),
            eq(projects.domain, input.domain)
          )
        )
        .limit(1);
      
      if (existing.length > 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A project with this domain already exists',
        });
      }
      
      const [newProject] = await db
        .insert(projects)
        .values({
          organizationId,
          name: input.name,
          domain: input.domain,
          sitemapUrl: input.sitemapUrl,
          settings: input.settings ?? {},
        })
        .returning();
      
      // Queue initial scan job
      await db.insert(jobs).values({
        projectId: newProject.id,
        type: 'FULL_SCAN',
        status: 'PENDING',
      });
      
      // Audit log
      await ctx.auditLog('project.created', 'project', newProject.id, {
        name: input.name,
        domain: input.domain,
      });
      
      return newProject;
    }),

  // Update project
  update: protectedProcedure
    .input(updateProjectSchema)
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      const { id, ...updates } = input;
      
      const [updated] = await db
        .update(projects)
        .set({
          ...updates,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(projects.id, id),
            eq(projects.organizationId, organizationId)
          )
        )
        .returning();
      
      if (!updated) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }
      
      await ctx.auditLog('project.updated', 'project', id, updates);
      
      return updated;
    }),

  // Delete project
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      const [deleted] = await db
        .delete(projects)
        .where(
          and(
            eq(projects.id, input.id),
            eq(projects.organizationId, organizationId)
          )
        )
        .returning({ id: projects.id, name: projects.name });
      
      if (!deleted) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }
      
      await ctx.auditLog('project.deleted', 'project', input.id, { name: deleted.name });
      
      return { success: true };
    }),

  // List URLs for a project with filtering/pagination
  listUrls: protectedProcedure
    .input(listUrlsSchema)
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      // Verify project belongs to org
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1);
      
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      
      // Build query conditions
      const conditions = [eq(urls.projectId, input.projectId)];
      
      if (input.status) {
        conditions.push(eq(urls.googleStatus, input.status));
      }
      
      if (input.search) {
        conditions.push(sql`${urls.loc} ILIKE ${`%${input.search}%`}`);
      }
      
      const offset = (input.page - 1) * input.pageSize;
      
      // Get total count
      const [{ total }] = await db
        .select({ total: count() })
        .from(urls)
        .where(and(...conditions));
      
      // Get paginated results
      const urlList = await db
        .select({
          id: urls.id,
          loc: urls.loc,
          lastmod: urls.lastmod,
          priority: urls.priority,
          googleStatus: urls.googleStatus,
          bingStatus: urls.bingStatus,
          googleSubmittedAt: urls.googleSubmittedAt,
          firstSeenAt: urls.firstSeenAt,
        })
        .from(urls)
        .where(and(...conditions))
        .orderBy(
          input.sortOrder === 'desc' 
            ? desc(urls[input.sortBy as keyof typeof urls]) 
            : urls[input.sortBy as keyof typeof urls]
        )
        .limit(input.pageSize)
        .offset(offset);
      
      return {
        urls: urlList,
        pagination: {
          page: input.page,
          pageSize: input.pageSize,
          total: Number(total),
          totalPages: Math.ceil(Number(total) / input.pageSize),
        },
      };
    }),

  // Trigger manual scan
  triggerScan: protectedProcedure
    .input(z.object({ 
      projectId: z.string().uuid(),
      type: z.enum(['FULL_SCAN', 'INCREMENTAL_SYNC']).default('INCREMENTAL_SYNC'),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      // Verify project
      const [project] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1);
      
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      
      // Check for existing pending/processing job
      const [existingJob] = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            eq(jobs.projectId, input.projectId),
            eq(jobs.type, input.type),
            sql`${jobs.status} IN ('PENDING', 'PROCESSING')`
          )
        )
        .limit(1);
      
      if (existingJob) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A scan job is already in progress for this project',
        });
      }
      
      // Create new job
      const [newJob] = await db
        .insert(jobs)
        .values({
          projectId: input.projectId,
          type: input.type,
          status: 'PENDING',
        })
        .returning();
      
      await ctx.auditLog('job.triggered', 'job', newJob.id, {
        projectId: input.projectId,
        type: input.type,
      });
      
      return newJob;
    }),

  // Submit URLs to search engines
  submitUrls: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      urlIds: z.array(z.string().uuid()).min(1).max(1000),
      engines: z.array(z.enum(['GOOGLE', 'BING', 'INDEXNOW'])).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      // Verify project
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1);
      
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      
      // Create submission job
      const [job] = await db
        .insert(jobs)
        .values({
          projectId: input.projectId,
          type: 'GOOGLE_SUBMISSION', // Will be determined by engine
          status: 'PENDING',
          metadata: {
            urlIds: input.urlIds,
            engines: input.engines,
          },
          totalItems: input.urlIds.length * input.engines.length,
        })
        .returning();
      
      await ctx.auditLog('submission.queued', 'job', job.id, {
        urlCount: input.urlIds.length,
        engines: input.engines,
      });
      
      return {
        jobId: job.id,
        queuedCount: input.urlIds.length * input.engines.length,
      };
    }),

  // Get analytics data
  getAnalytics: protectedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      dateRange: z.enum(['7d', '30d', '90d']).default('30d'),
    }))
    .query(async ({ ctx, input }) => {
      const { db, organizationId } = ctx;
      
      // Verify project
      const [project] = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.id, input.projectId),
            eq(projects.organizationId, organizationId)
          )
        )
        .limit(1);
      
      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }
      
      const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
      const days = daysMap[input.dateRange];
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Indexing rate over time (aggregated by day)
      const indexingTrend = await db.execute(sql`
        SELECT 
          DATE_TRUNC('day', first_seen_at) as date,
          COUNT(*) FILTER (WHERE google_status = 'INDEXED') as indexed,
          COUNT(*) FILTER (WHERE google_status = 'SUBMITTED') as submitted,
          COUNT(*) as total
        FROM urls
        WHERE project_id = ${input.projectId}
          AND first_seen_at >= ${startDate}
        GROUP BY DATE_TRUNC('day', first_seen_at)
        ORDER BY date ASC
      `);
      
      // Status distribution
      const statusDistribution = await db
        .select({
          status: urls.googleStatus,
          count: count(),
        })
        .from(urls)
        .where(eq(urls.projectId, input.projectId))
        .groupBy(urls.googleStatus);
      
      // Average time to index (for indexed URLs)
      const [avgTimeToIndex] = await db.execute(sql`
        SELECT 
          AVG(EXTRACT(EPOCH FROM (google_submitted_at - first_seen_at))) as avg_submission_time,
          AVG(EXTRACT(EPOCH FROM (google_last_checked_at - google_submitted_at))) as avg_index_time
        FROM urls
        WHERE project_id = ${input.projectId}
          AND google_status = 'INDEXED'
          AND google_submitted_at IS NOT NULL
      `);
      
      return {
        indexingTrend: indexingTrend.rows,
        statusDistribution: Object.fromEntries(
          statusDistribution.map(s => [s.status, Number(s.count)])
        ),
        avgTimeToIndex: avgTimeToIndex,
      };
    }),
});
