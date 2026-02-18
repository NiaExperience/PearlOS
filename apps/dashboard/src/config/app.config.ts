/**
 * Application-level configuration
 * Contains constants, IDs, and other non-environment specific settings
 */

export const appConfig = {
  upload: {
    // maxFileSize: 5 * 1024 * 1024, // 5MB in bytes
    maxBatchSize: 100, // Maximum number of files in a batch
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    allowedDataTypes: ['application/zip', 'text/csv', 'application/json'],
  },
  database: {
    batchSize: 10, // Process items in batches of 10
  },

  /**
   * S3 upload settings
   */
  s3: {
    presignedUrlExpiration: 15 * 60, // 15 minutes in seconds
  },
} as const;

/**
 * Type definitions for the app config
 */
export type AppConfig = typeof appConfig; 