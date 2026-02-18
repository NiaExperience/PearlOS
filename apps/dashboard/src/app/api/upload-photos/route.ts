import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { getSessionSafely, requireTenantAdmin } from "@nia/prism/core/auth";
import { TenantActions, ContentActions } from '@nia/prism/core/actions';
import { Prism } from '@nia/prism';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    console.log("🚀 Starting photo album upload...");
    const session = await getSessionSafely(req, dashboardAuthOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    let tenantId = searchParams.get('tenantId');

    const body = await req.json();
    const { photos, albumName, assistantId, contentType } = body;
    if (!tenantId) {
      tenantId = body.tenantId;
    }
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
    }
    if (!contentType) {
      return NextResponse.json({ error: "Content type is required" }, { status: 400 });
    }
    
    // Use provider-agnostic Prism API (ensures initialization)
    const prism = await Prism.getInstance();
    const contentDefinition = await prism.findDefinition(contentType, tenantId);
    if (!contentDefinition || contentDefinition.items.length === 0) {
      return NextResponse.json({ error: 'Unsupported content type' }, { status: 404 });
    } 
    
    const authError = await requireTenantAdmin(tenantId, req, dashboardAuthOptions);
    if (authError) {
      return authError;
    }

    console.log("📤 Photo Album Upload API Called:");
    console.log("📁 Album Name:", albumName);
    console.log("📋 Assistant ID:", assistantId);
    console.log("📸 Photo Count:", photos?.length || 0);

    // Validation
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      console.error("❌ Missing or invalid photos array");
      return NextResponse.json({ 
        error: 'Photos array is required and must contain at least one photo' 
      }, { status: 400 });
    }

    if (!albumName || typeof albumName !== 'string') {
      console.error("❌ Missing or invalid album name");
      return NextResponse.json({ 
        error: 'Album name is required and must be a string' 
      }, { status: 400 });
    }

    if (!assistantId) {
      console.error("❌ Missing assistant ID");
      return NextResponse.json({ 
        error: 'Assistant ID is required' 
      }, { status: 400 });
    }

    // Transform photos array to match the expected format
    const imageUrls = photos.map((photo: { url: string; album: string }) => ({
      url: photo.url,
      album: photo.album
    }));

    // Prepare photo album data for provider-agnostic Prism API
    const photoData = {
      imageUrls: imageUrls,
      userId: session.user.id,
      assistant_id: assistantId,
      album: albumName
    };

    console.log("🔍 Looking for existing photo album ...");

    // Look for a photo record with the assistant, user, and album, update that if found
    const where: any = { 
      parent_id: assistantId,
      AND: [
        { indexer: { path: "userId", equals: session.user.id } },
        { indexer: { path: "album", equals: albumName } }
      ]
    };
    const items = await ContentActions.findContent({
      contentType: contentType,
      tenantId: tenantId,
      where: where,
    });
    if (items && items.items && items.items.length > 0) {
      console.log("🎯 Found existing photo album, updating it...");
      const existingPhoto = items.items[0];
      // Use atomic merge - only send fields being updated
      const updated = await prism.update(contentType, existingPhoto._id!, photoData, tenantId);
      if (!updated || updated.total === 0 || updated.items.length === 0) {
        console.error("❌ Failed to update existing photo album");
        return NextResponse.json({ 
          error: 'Failed to update existing photo album' 
        }, { status: 500 });
      }
      console.log("✅ Successfully updated existing photo album:", updated.items[0]._id);
      const response = {
        success: true,
        photoAlbumId: updated.items[0]._id!,
        albumName: albumName,
        photoCount: photos.length,
        message: `Successfully updated photo album \"${albumName}\" with ${photos.length} photos`
      };
      return NextResponse.json(response);
    }

    console.log("📝 Creating photo album with data:", photoData);
    const created = await prism.create('Photo', photoData, tenantId);
    if (!created || created.total === 0 || created.items.length === 0) {
      console.error("❌ Failed to create photo album");
      return NextResponse.json({ 
        error: 'Failed to create photo album' 
      }, { status: 500 });
    }

    console.log("✅ Successfully created photo album:");
    console.log("🔗 Photo Album ID:", created.items[0]._id);

    const response = {
      success: true,
      photoAlbumId: created.items[0]._id,
      albumName: albumName,
      photoCount: photos.length,
      message: `Successfully created photo album \"${albumName}\" with ${photos.length} photos`
    };
    return NextResponse.json(response);

  } catch (error: any) {
    console.error("❌ Error in upload-photos API:", {
      name: error.name,
      message: error.message,
      stack: error.stack
    });

    return NextResponse.json({
      success: false,
      error: 'Failed to create photo album',
      details: error.message
    }, { status: 500 });
  }
} 