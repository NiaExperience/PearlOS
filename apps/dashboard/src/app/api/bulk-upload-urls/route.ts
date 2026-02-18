export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireTenantAdmin } from '@nia/prism/core/auth';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

// Configure S3 client with better error handling
const createS3Client = () => {
  const region = process.env.AWS_REGION || process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1';
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing required AWS environment variables");
  }

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const tenantId = searchParams.get('tenantId');
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
  }

  const authError = await requireTenantAdmin(tenantId, request as NextRequest, dashboardAuthOptions);
  if (authError) {
    return NextResponse.json({ error: String(authError) }, { status: 401 });
  }

  try {
    console.log("🚀 Starting bulk upload URL generation...");
    
    // Enhanced validation
    const { files } = await request.json();
    if (!files || !Array.isArray(files)) {
      console.error("❌ Invalid files parameter - must be an array");
      return NextResponse.json(
        { error: "Files must be an array" },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      console.error("❌ Empty files array");
      return NextResponse.json(
        { error: "At least one file is required" },
        { status: 400 }
      );
    }

    if (files.length > 100) {
      console.error("❌ Too many files requested");
      return NextResponse.json(
        { error: "Maximum 100 files allowed per request" },
        { status: 400 }
      );
    }

    // Validate each file object
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.filename || !file.fileType) {
        console.error(`❌ Invalid file at index ${i}: missing filename or fileType`);
        return NextResponse.json(
          { error: `File at index ${i} is missing filename or fileType` },
          { status: 400 }
        );
      }
    }

    const bucketName = process.env.NEXT_PUBLIC_AWS_S3_BUCKET_NAME;
    if (!bucketName) {
      console.error("❌ S3 bucket name not configured");
      return NextResponse.json(
        { error: "S3 bucket not configured" },
        { status: 500 }
      );
    }

    console.log(`📋 Generating URLs for ${files.length} files...`);

    // Create S3 client
    const s3Client = createS3Client();

    // Generate presigned URLs for all files in parallel
    const urlPromises = files.map(async (fileData: { filename: string; fileType: string }, index: number) => {
      try {
        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: fileData.filename,
          ContentType: fileData.fileType,
        });

        // Generate presigned URL that expires in 10 minutes
        const presignedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: 600,
        });

        console.log(`✅ Generated URL ${index + 1}/${files.length}: ${fileData.filename}`);
        return { success: true, url: presignedUrl, filename: fileData.filename };
      } catch (error) {
        console.error(`❌ Failed to generate URL for ${fileData.filename}:`, error);
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error', filename: fileData.filename };
      }
    });

    // Wait for all presigned URLs to be generated
    const results = await Promise.all(urlPromises);
    
    // Separate successful and failed results
    const successful = results.filter(r => r.success).map(r => r.url);
    const failed = results.filter(r => !r.success);

    console.log(`✅ Generated ${successful.length}/${files.length} URLs successfully`);
    
    if (failed.length > 0) {
      console.warn(`⚠️ ${failed.length} URLs failed to generate:`, failed);
    }

    return NextResponse.json({
      urls: successful,
      totalRequested: files.length,
      successCount: successful.length,
      failureCount: failed.length,
      failures: failed.length > 0 ? failed : undefined,
      message: `Successfully generated ${successful.length}/${files.length} upload URLs`
    });

  } catch (error) {
    console.error("❌ Error generating bulk upload URLs:", error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      { 
        error: "Failed to generate upload URLs",
        details: errorMessage,
        totalRequested: 0,
        successCount: 0,
        failureCount: 0
      },
      { status: 500 }
    );
  }
} 