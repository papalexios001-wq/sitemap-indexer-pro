export enum JobStatus {
  IDLE = 'IDLE',
  SCANNING = 'SCANNING',
  PARSING = 'PARSING',
  SUBMITTING = 'SUBMITTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED'
}

export enum IndexerType {
  GOOGLE = 'GOOGLE',
  INDEXNOW = 'INDEXNOW',
  GSC_INSPECTION = 'GSC_INSPECTION'
}

export interface Project {
  id: string;
  name: string;
  domain: string;
  sitemapIndexUrl: string;
  serviceAccountEmail?: string;
  indexNowKey?: string;
  status: JobStatus;
  stats: {
    totalUrls: number;
    submitted: number;
    indexed: number;
    errors: number;
  };
}

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  module: 'STREAM' | 'DB' | 'WORKER' | 'API';
}

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  secondary?: number;
}