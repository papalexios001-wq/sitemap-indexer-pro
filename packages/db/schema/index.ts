import { 
  pgTable, 
  uuid, 
  varchar, 
  text, 
  timestamp, 
  integer, 
  boolean, 
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  decimal
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ============ ENUMS ============
export const planEnum = pgEnum('plan', ['FREE', 'PRO', 'ENTERPRISE']);
export const indexingStatusEnum = pgEnum('indexing_status', [
  'DISCOVERED',
  'QUEUED', 
  'SUBMITTED',
  'INDEXED',
  'NOT_INDEXED',
  'CRAWL_ERROR',
  'BLOCKED_ROBOTS',
  'BLOCKED_NOINDEX',
  'REDIRECT',
  'ERROR_4XX',
  'ERROR_5XX',
  'DUPLICATE'
]);
export const jobStatusEnum = pgEnum('job_status', [
  'PENDING',
  'PROCESSING', 
  'COMPLETED',
  'FAILED',
  'CANCELLED'
]);
export const jobTypeEnum = pgEnum('job_type', [
  'FULL_SCAN',
  'INCREMENTAL_SYNC',
  'GOOGLE_SUBMISSION',
  'INDEXNOW_SUBMISSION',
  'STATUS_CHECK'
]);
export const searchEngineEnum = pgEnum('search_engine', [
  'GOOGLE',
  'BING', 
  'YANDEX',
  'INDEXNOW'
]);

// ============ ORGANIZATIONS ============
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  plan: planEnum('plan').default('FREE').notNull(),
  settings: jsonb('settings').default({}).$type<OrganizationSettings>(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  slugIdx: uniqueIndex('org_slug_idx').on(table.slug),
}));

export type OrganizationSettings = {
  defaultQuotas?: Record<string, number>;
  webhookUrl?: string;
  timezone?: string;
};

// ============ USERS ============
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: varchar('clerk_id', { length: 255 }).unique().notNull(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  name: varchar('name', { length: 255 }),
  avatarUrl: text('avatar_url'),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).default('member').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  clerkIdx: uniqueIndex('user_clerk_idx').on(table.clerkId),
  emailIdx: uniqueIndex('user_email_idx').on(table.email),
  orgIdx: index('user_org_idx').on(table.organizationId),
}));

// ============ PROJECTS ============
export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  sitemapUrl: text('sitemap_url').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  settings: jsonb('settings').default({}).$type<ProjectSettings>(),
  
  // Cached stats (updated by workers)
  totalUrls: integer('total_urls').default(0).notNull(),
  indexedUrls: integer('indexed_urls').default(0).notNull(),
  pendingUrls: integer('pending_urls').default(0).notNull(),
  errorUrls: integer('error_urls').default(0).notNull(),
  
  lastScanAt: timestamp('last_scan_at', { withTimezone: true }),
  lastSubmissionAt: timestamp('last_submission_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('project_org_idx').on(table.organizationId),
  domainIdx: index('project_domain_idx').on(table.domain),
}));

export type ProjectSettings = {
  autoSync?: boolean;
  syncFrequencyHours?: number;
  priorityEngines?: string[];
  excludePatterns?: string[];
};

// ============ SITEMAPS ============
export const sitemaps = pgTable('sitemaps', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  type: varchar('type', { length: 20 }).notNull(), // 'INDEX' | 'URLSET' | 'RSS'
  parentId: uuid('parent_id'), // For nested sitemaps
  urlCount: integer('url_count').default(0).notNull(),
  etag: varchar('etag', { length: 255 }),
  lastModified: timestamp('last_modified', { withTimezone: true }),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  contentHash: varchar('content_hash', { length: 64 }), // SHA-256
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  projectIdx: index('sitemap_project_idx').on(table.projectId),
  urlIdx: uniqueIndex('sitemap_url_idx').on(table.projectId, table.url),
}));

// ============ URLS ============
export const urls = pgTable('urls', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  sitemapId: uuid('sitemap_id').references(() => sitemaps.id, { onDelete: 'set null' }),
  
  // URL data from sitemap
  loc: text('loc').notNull(),
  locHash: varchar('loc_hash', { length: 64 }).notNull(), // SHA-256 for fast lookups
  lastmod: timestamp('lastmod', { withTimezone: true }),
  changefreq: varchar('changefreq', { length: 20 }),
  priority: decimal('priority', { precision: 2, scale: 1 }),
  
  // Indexing status per engine
  googleStatus: indexingStatusEnum('google_status').default('DISCOVERED'),
  googleSubmittedAt: timestamp('google_submitted_at', { withTimezone: true }),
  googleLastCheckedAt: timestamp('google_last_checked_at', { withTimezone: true }),
  
  bingStatus: indexingStatusEnum('bing_status').default('DISCOVERED'),
  bingSubmittedAt: timestamp('bing_submitted_at', { withTimezone: true }),
  
  // Inspection data (from GSC API)
  coverageState: varchar('coverage_state', { length: 50 }),
  crawledAs: varchar('crawled_as', { length: 50 }),
  robotsTxtState: varchar('robots_txt_state', { length: 50 }),
  indexingState: varchar('indexing_state', { length: 50 }),
  lastCrawlTime: timestamp('last_crawl_time', { withTimezone: true }),
  
  // Metadata
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp('removed_at', { withTimezone: true }), // Soft delete tracking
  metadata: jsonb('metadata').default({}),
}, (table) => ({
  projectIdx: index('url_project_idx').on(table.projectId),
  locHashIdx: uniqueIndex('url_loc_hash_idx').on(table.projectId, table.locHash),
  googleStatusIdx: index('url_google_status_idx').on(table.googleStatus),
  bingStatusIdx: index('url_bing_status_idx').on(table.bingStatus),
}));

// ============ SUBMISSIONS ============
export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  urlId: uuid('url_id').references(() => urls.id, { onDelete: 'cascade' }).notNull(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  engine: searchEngineEnum('engine').notNull(),
  action: varchar('action', { length: 20 }).default('URL_UPDATED').notNull(),
  
  status: jobStatusEnum('status').default('PENDING').notNull(),
  attempts: integer('attempts').default(0).notNull(),
  maxAttempts: integer('max_attempts').default(3).notNull(),
  
  responseCode: integer('response_code'),
  responseBody: jsonb('response_body'),
  errorMessage: text('error_message'),
  
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
}, (table) => ({
  urlIdx: index('submission_url_idx').on(table.urlId),
  projectIdx: index('submission_project_idx').on(table.projectId),
  statusIdx: index('submission_status_idx').on(table.status, table.scheduledAt),
  engineIdx: index('submission_engine_idx').on(table.engine),
}));

// ============ JOBS ============
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  type: jobTypeEnum('type').notNull(),
  status: jobStatusEnum('status').default('PENDING').notNull(),
  
  progress: integer('progress').default(0).notNull(), // 0-100
  totalItems: integer('total_items').default(0),
  processedItems: integer('processed_items').default(0),
  
  metadata: jsonb('metadata').default({}),
  errorMessage: text('error_message'),
  
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  projectIdx: index('job_project_idx').on(table.projectId),
  statusIdx: index('job_status_idx').on(table.status),
  typeIdx: index('job_type_idx').on(table.type),
}));

// ============ CREDENTIALS (ENCRYPTED) ============
export const credentials = pgTable('credentials', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  engine: searchEngineEnum('engine').notNull(),
  type: varchar('type', { length: 50 }).notNull(), // 'SERVICE_ACCOUNT' | 'API_KEY' | 'OAUTH'
  
  // Encrypted with AES-256-GCM
  encryptedData: text('encrypted_data').notNull(),
  iv: varchar('iv', { length: 32 }).notNull(),
  authTag: varchar('auth_tag', { length: 32 }).notNull(),
  
  isValid: boolean('is_valid').default(true),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  projectEngineIdx: uniqueIndex('credential_project_engine_idx').on(table.projectId, table.engine),
}));

// ============ QUOTA TRACKING ============
export const quotaUsage = pgTable('quota_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }).notNull(),
  engine: searchEngineEnum('engine').notNull(),
  date: timestamp('date', { mode: 'date' }).notNull(),
  used: integer('used').default(0).notNull(),
  limit: integer('limit').notNull(),
}, (table) => ({
  uniqueIdx: uniqueIndex('quota_unique_idx').on(table.projectId, table.engine, table.date),
}));

// ============ AUDIT LOG ============
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orgIdx: index('audit_org_idx').on(table.organizationId),
  createdIdx: index('audit_created_idx').on(table.createdAt),
}));

// ============ RELATIONS ============
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  projects: many(projects),
  auditLogs: many(auditLogs),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organization: one(organizations, {
    fields: [users.organizationId],
    references: [organizations.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [projects.organizationId],
    references: [organizations.id],
  }),
  sitemaps: many(sitemaps),
  urls: many(urls),
  jobs: many(jobs),
  credentials: many(credentials),
}));

export const sitemapsRelations = relations(sitemaps, ({ one, many }) => ({
  project: one(projects, {
    fields: [sitemaps.projectId],
    references: [projects.id],
  }),
  urls: many(urls),
}));

export const urlsRelations = relations(urls, ({ one, many }) => ({
  project: one(projects, {
    fields: [urls.projectId],
    references: [projects.id],
  }),
  sitemap: one(sitemaps, {
    fields: [urls.sitemapId],
    references: [sitemaps.id],
  }),
  submissions: many(submissions),
}));
