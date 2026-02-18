import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { readFile, readdir } from 'fs/promises';
import { NextRequest, NextResponse } from "next/server";
import { tmpdir } from 'os';
import { join } from 'path';

import { Prism } from '@nia/prism';
import { TenantActions, ContentActions } from '@nia/prism/core/actions';
import { requireTenantAdmin } from '@nia/prism/core/auth';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const assistantId = searchParams.get('assistantId');
    const tempFile = searchParams.get('tempFile');
    const tenantId = searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: "Tenant ID is required" }, { status: 400 });
    }
  
    const authError = await requireTenantAdmin(tenantId, req, dashboardAuthOptions);
    if (authError) {
      return NextResponse.json({ error: authError }, { status: 403 });
    }
    
    const result: any = {
      timestamp: new Date().toISOString(),
      tempFiles: [],
      databaseCounts: {},
      sampleData: null
    };

    // List all upload temp files
    try {
      const tempDir = tmpdir();
      const files = await readdir(tempDir);
      const uploadFiles = files.filter(f => f.startsWith('upload-'));
      
      result.tempFiles = uploadFiles.map(file => ({
        name: file,
        path: join(tempDir, file)
      }));
    } catch (error) {
      result.tempFilesError = (error as Error).message;
    }

    // If specific temp file requested, read its contents
    if (tempFile) {
      try {
        const data = await readFile(tempFile, 'utf-8');
        const parsed = JSON.parse(data);
        result.sampleData = {
          totalItems: parsed.length,
          firstItem: parsed[0],
          lastItem: parsed[parsed.length - 1],
          sampleStructure: Object.keys(parsed[0] || {})
        };
      } catch (error) {
        result.tempFileError = (error as Error).message;
      }
    }

    // Get database counts for assistant
    if (assistantId) {
      // 1. Get the definitions for the tenant
      // 2. Query for each contentType
      // 3. Count.
      const prism = await Prism.getInstance();
      console.log("🔍 Looking for definitions for tenant:", tenantId);
      const definitions = await prism.listDefinitions(tenantId);
      console.log("📊 Found definitions:", definitions?.total || 0, "items:", definitions?.items?.map(d => d.dataModel?.block) || []);
      if (!definitions || definitions.total === 0) {
        console.log("❌ No content definitions found for tenant");
        return NextResponse.json({ error: "No content definitions found for tenant" }, { status: 404 });
      }
      const contentTypes = definitions.items.map(item => item.dataModel.block);
      console.log("Content types for tenant:", contentTypes);
      
      // For each content type, count the number of unique items with assistant_id
      const contentTypeToIds: Record<string, Set<string>> = {};
      for (const contentType of contentTypes) {
        const query = {
          contentType: contentType,
          tenantId: tenantId,
          where: { parent_id: assistantId },
        };
        const result = await ContentActions.findContent(query);
        if (result && result.items.length > 0) {
          for (const item of result.items) {
            if (!contentTypeToIds[contentType]) {
              contentTypeToIds[contentType] = new Set();
            }
            contentTypeToIds[contentType].add(item._id);
          }
        }
      }
      const blockTypeCounts: Record<string, number> = {};
      for (const [type, idSet] of Object.entries(contentTypeToIds)) {
        blockTypeCounts[type] = idSet.size;
      }
      result.databaseCounts = blockTypeCounts;
      console.log("📊 Database counts for assistant:", result.databaseCounts);

      // Get sample documents
      try {
        const query = {
          contentType: 'Guest',
          tenantId: tenantId,
          where: { parent_id: assistantId },
        };
        const query_result = await ContentActions.findContent(query);

        const sampleGuest = (query_result.items.length > 0 && query_result.items[0]) || undefined;
        if (sampleGuest) {
          result.sampleDocument = {
            collection: 'guests',
            document: sampleGuest
          };
        }
      } catch (error) {
        result.sampleDocumentError = (error as Error).message;
      }
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error("Debug API error:", error);
    return NextResponse.json({ 
      error: 'Debug API failed',
      details: error.message
    }, { status: 500 });
  }
} 
export const dynamic = "force-dynamic";