import pino from 'pino';

// ============ CONFIGURATION ============
const isDevelopment = process.env.NODE_ENV !== 'production';

// ============ LOGGER INSTANCE ============
export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  
  // Pretty print in development
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  
  // Base fields included in every log
  base: {
    service: 'sitemap-indexer-worker',
    version: process.env.APP_VERSION || '1.0.0',
    env: process.env.NODE_ENV || 'development',
  },
  
  // Timestamp format
  timestamp: pino.stdTimeFunctions.isoTime,
  
  // Redact sensitive fields
  redact: {
    paths: [
      'password',
      'token',
      'apiKey',
      'authorization',
      'cookie',
      'encryptedData',
      'serviceAccountJson',
      '*.password',
      '*.token',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
  
  // Serializers for common objects
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
    req: (req) => ({
      method: req.method,
      url: req.url,
      headers: {
        'user-agent': req.headers['user-agent'],
        'content-type': req.headers['content-type'],
      },
    }),
    res: (res) => ({
      statusCode: res.statusCode,
    }),
  },
});

// ============ CHILD LOGGERS FOR MODULES ============
export const createModuleLogger = (module: string) => {
  return logger.child({ module });
};

// Pre-created module loggers
export const dbLogger = createModuleLogger('database');
export const apiLogger = createModuleLogger('api');
export const workerLogger = createModuleLogger('worker');
export const queueLogger = createModuleLogger('queue');

// ============ REQUEST CONTEXT LOGGER ============
export const createRequestLogger = (requestId: string, userId?: string) => {
  return logger.child({
    requestId,
    userId,
  });
};

// ============ JOB CONTEXT LOGGER ============
export const createJobLogger = (jobId: string, jobType: string, projectId: string) => {
  return logger.child({
    jobId,
    jobType,
    projectId,
  });
};

export default logger;
