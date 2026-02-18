import { resolve } from 'path';

import * as dotenv from 'dotenv';

// Load environment from root .env.local
const projectRoot = resolve(__dirname, '../../../..');
const envPath = resolve(projectRoot, '.env.local');

// Load environment variables
const result = dotenv.config({ path: envPath });
if (result.parsed) {
  console.log(`✓ Loaded environment from ${envPath}`);
}

export const envConfig = {
    database: {
        url: process.env.DATABASE_URL,
    },
    aws: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || process.env.NEXT_PUBLIC_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || process.env.NEXT_PUBLIC_AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
        s3BucketName: process.env.AWS_S3_BUCKET_NAME || process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME || 'nia-photosbucket',
    },
};