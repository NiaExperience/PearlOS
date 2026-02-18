import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireTenantAdmin, requireAuth } from '@nia/prism/core/auth';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    console.log('=== S3 Presigned URL Request ===');
    
    const { filename, fileType, tenantId } = await req.json();
    
    // Check authentication first
    const authError = await requireAuth(req, dashboardAuthOptions);
    if (authError) return NextResponse.json({ error: String(authError) }, { status: 401 });
    
    // Then check tenant admin access
    const authError2 = await requireTenantAdmin(tenantId, req, dashboardAuthOptions);
    if (authError2) return NextResponse.json({ error: String(authError2) }, { status: 401 });
    
    console.log('Request data:', { filename, fileType });

    if (!filename || !fileType) {
      console.error('Missing required fields:', { filename, fileType });
      return NextResponse.json(
        { error: 'Filename and fileType are required' },
        { status: 400 }
      );
    }

    // Use the bucket name from environment variables
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    console.log('Environment check:', {
      bucketName: bucketName ? 'SET' : 'NOT SET',
      region: process.env.AWS_REGION || 'us-east-1',
      accessKey: process.env.AWS_ACCESS_KEY_ID ? 'SET' : 'NOT SET',
      secretKey: process.env.AWS_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'
    });

    if (!bucketName) {
      console.error('AWS S3 bucket name not configured');
      return NextResponse.json(
        { error: 'AWS S3 bucket name not configured' },
        { status: 500 }
      );
    }

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: filename,
      ContentType: fileType,
    });

    console.log('Generating presigned URL for:', { bucket: bucketName, key: filename, contentType: fileType });

    const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

    console.log('✅ Presigned URL generated successfully');
    return NextResponse.json({ url });
  } catch (error) {
    console.error('❌ Error generating presigned URL:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      name: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack : 'No stack trace'
    });
    return NextResponse.json(
      { error: 'Failed to generate presigned URL' },
      { status: 500 }
    );
  }
} 