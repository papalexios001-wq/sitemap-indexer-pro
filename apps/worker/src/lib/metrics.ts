import { 
  MeterProvider, 
  PeriodicExportingMetricReader 
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

// ============ CONFIGURATION ============
const OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318/v1/metrics';
const SERVICE_NAME = 'sitemap-indexer-worker';
const EXPORT_INTERVAL_MS = 60000; // 1 minute

// ============ SETUP ============
const resource = new Resource({
  [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
  [SemanticResourceAttributes.SERVICE_VERSION]: process.env.APP_VERSION || '1.0.0',
  [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
});

const metricExporter = new OTLPMetricExporter({
  url: OTLP_ENDPOINT,
});

const meterProvider = new MeterProvider({
  resource,
  readers: [
    new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: EXPORT_INTERVAL_MS,
    }),
  ],
});

const meter = meterProvider.getMeter(SERVICE_NAME);

// ============ METRICS ============

// Counters
const urlsDiscoveredCounter = meter.createCounter('urls_discovered_total', {
  description: 'Total number of URLs discovered from sitemaps',
});

const submissionsCounter = meter.createCounter('submissions_total', {
  description: 'Total number of URL submissions to search engines',
});

const jobsCounter = meter.createCounter('jobs_total', {
  description: 'Total number of jobs processed',
});

const errorsCounter = meter.createCounter('errors_total', {
  description: 'Total number of errors',
});

// Histograms
const jobDurationHistogram = meter.createHistogram('job_duration_ms', {
  description: 'Duration of job execution in milliseconds',
  unit: 'ms',
});

const sitemapScanDurationHistogram = meter.createHistogram('sitemap_scan_duration_ms', {
  description: 'Duration of sitemap scanning in milliseconds',
  unit: 'ms',
});

const apiLatencyHistogram = meter.createHistogram('api_latency_ms', {
  description: 'Latency of external API calls in milliseconds',
  unit: 'ms',
});

// Gauges (using observable)
const activeJobsGauge = meter.createObservableGauge('active_jobs', {
  description: 'Number of currently active jobs',
});

const queueSizeGauge = meter.createObservableGauge('queue_size', {
  description: 'Number of jobs in queue',
});

// ============ METRICS API ============
export const metrics = {
  counter: (name: string, value: number = 1, attributes: Record<string, string> = {}) => {
    switch (name) {
      case 'urls_discovered_total':
        urlsDiscoveredCounter.add(value, attributes);
        break;
      case 'submissions_total':
      case 'google_submissions_total':
      case 'indexnow_submissions_total':
        submissionsCounter.add(value, { ...attributes, engine: name.split('_')[0] });
        break;
      case 'jobs_total':
        jobsCounter.add(value, attributes);
        break;
      case 'errors_total':
        errorsCounter.add(value, attributes);
        break;
      default:
        // Generic counter
        const genericCounter = meter.createCounter(name, {
          description: `Counter for ${name}`,
        });
        genericCounter.add(value, attributes);
    }
  },
  
  histogram: (name: string, value: number, attributes: Record<string, string> = {}) => {
    switch (name) {
      case 'job_duration_ms':
        jobDurationHistogram.record(value, attributes);
        break;
      case 'sitemap_scan_duration_ms':
        sitemapScanDurationHistogram.record(value, attributes);
        break;
      case 'api_latency_ms':
      case 'google_submission_duration_ms':
      case 'indexnow_submission_duration_ms':
        apiLatencyHistogram.record(value, attributes);
        break;
      default:
        const genericHistogram = meter.createHistogram(name, {
          description: `Histogram for ${name}`,
          unit: 'ms',
        });
        genericHistogram.record(value, attributes);
    }
  },
  
  // Register gauge callbacks
  registerActiveJobsCallback: (callback: () => number) => {
    activeJobsGauge.addCallback((result) => {
      result.observe(callback());
    });
  },
  
  registerQueueSizeCallback: (queueName: string, callback: () => Promise<number>) => {
    queueSizeGauge.addCallback(async (result) => {
      const size = await callback();
      result.observe(size, { queue: queueName });
    });
  },
};

// ============ GRACEFUL SHUTDOWN ============
export async function shutdownMetrics(): Promise<void> {
  await meterProvider.shutdown();
}

export default metrics;
