// This file contains the Prisma Schema as requested in Phase 1
// It is displayed in the "System Config" tab of the application.

export const PRISMA_SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Project {
  id                String    @id @default(cuid())
  name              String
  domain            String    @unique
  sitemapIndexUrl   String
  serviceAccountJson String?  @db.Text // Encrypted
  indexNowKey       String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  sitemaps          Sitemap[]
  jobs              Job[]
}

model Sitemap {
  id          String   @id @default(cuid())
  projectId   String
  url         String
  isIndex     Boolean  @default(false)
  lastScanned DateTime?
  etag        String?
  
  project     Project  @relation(fields: [projectId], references: [id])
  urls        UrlEntry[]

  @@unique([projectId, url])
}

model UrlEntry {
  id              String    @id @default(cuid())
  sitemapId       String
  url             String
  lastmod         DateTime?
  changefreq      String?
  priority        Float?
  
  // Status Tracking
  status          IndexingStatus @default(DISCOVERED)
  googleSubmittedAt DateTime?
  bingSubmittedAt   DateTime?
  lastInspectedAt   DateTime?
  
  // Inspection Results
  isIndexed       Boolean   @default(false)
  coverageState   String?

  sitemap         Sitemap   @relation(fields: [sitemapId], references: [id])

  @@unique([sitemapId, url])
  @@index([status])
}

model Job {
  id        String    @id @default(cuid())
  projectId String
  type      JobType
  status    JobStatus @default(PENDING)
  logs      Log[]
  createdAt DateTime  @default(now())
  
  project   Project   @relation(fields: [projectId], references: [id])
}

enum IndexingStatus {
  DISCOVERED
  QUEUED
  SUBMITTED
  INDEXED
  FAILED
}

enum JobType {
  FULL_SCAN
  INCREMENTAL_SYNC
  SUBMISSION
}

enum JobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
`;