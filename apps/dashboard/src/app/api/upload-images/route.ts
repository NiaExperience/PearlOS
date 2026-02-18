import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { requireTenantAdmin, requireAuth } from '@nia/prism/core/auth';

// Configure AWS S3 (v3 client). Prefer default credential chain; fall back to explicit env creds if provided.
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  } : undefined,
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'nia-photosbucket';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    console.log("🚀 Starting image upload to S3...");

    const formData = await req.formData();
    const tenantId = formData.get('tenantId') as string;
    
    // Check authentication first
    const authError = await requireAuth(req, dashboardAuthOptions);
    if (authError) return NextResponse.json({ error: String(authError) }, { status: 401 });
    
    // Then check tenant admin access
    const authError2 = await requireTenantAdmin(tenantId, req, dashboardAuthOptions);
    if (authError2) return NextResponse.json({ error: String(authError2) }, { status: 401 });

    const file = formData.get('file') as File;
    const assistantName = formData.get('assistantName') as string;
    const contentType = formData.get('contentType') as string;
    const fileName = formData.get('fileName') as string;

    console.log("📤 Image Upload API Called:");
    console.log("📁 Assistant Name:", assistantName);
    console.log("📋 Content Type:", contentType);
    console.log("📄 File Name:", fileName);
    console.log("📊 File Size:", file?.size || 0);

    // Validation
    if (!file || !assistantName || !contentType || !fileName) {
      console.error("❌ Missing required fields");
      return NextResponse.json({ 
        error: 'Missing required fields: file, assistantName, contentType, fileName' 
      }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      console.error("❌ Invalid file type:", file.type);
      return NextResponse.json({ 
        error: 'Invalid file type. Only JPG, PNG, GIF, and WEBP are allowed.' 
      }, { status: 400 });
    }

    // Sanitize file name but preserve original name structure
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    
    // Create S3 key with proper folder structure: assistantName/contentType/fileName
    const s3Key = `${assistantName}/${contentType}/${sanitizedFileName}`;

    console.log("🔑 S3 Key:", s3Key);

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3 using v3 client
    const putParams = {
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: buffer,
      ContentType: file.type,
      ACL: 'public-read' as const,
    };

    console.log("📤 Uploading to S3 (v3 client)...");
    await s3Client.send(new PutObjectCommand(putParams));

    const region = process.env.AWS_REGION || 'us-east-1';
    const publicUrl = region === 'us-east-1'
      ? `https://${BUCKET_NAME}.s3.amazonaws.com/${encodeURIComponent(s3Key)}`
      : `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${encodeURIComponent(s3Key)}`;

    console.log("✅ Successfully uploaded to S3 (v3)");
    console.log("🔗 S3 URL:", publicUrl);

    return NextResponse.json({
      success: true,
      url: publicUrl,
      key: s3Key,
      fileName: sanitizedFileName,
      contentType: file.type,
      size: file.size,
      message: `Successfully uploaded ${fileName} to S3`
    });

  } catch (error: any) {
    console.error("❌ Error in upload-images API:", error);
    console.error("❌ Error details:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to upload image to S3',
      details: error.message
    }, { status: 500 });
  }
} 