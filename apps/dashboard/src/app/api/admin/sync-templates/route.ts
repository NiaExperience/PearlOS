import { NextRequest, NextResponse } from 'next/server';

import { seedHtmlLibraryTemplates } from '@dashboard/lib/template-seeder';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/sync-templates
 * 
 * Syncs the Creation Engine library templates to the database.
 * This endpoint triggers the seed script to upsert all template applets
 * and configure sharing organizations.
 * 
 * Requires admin authentication.
 */
export async function POST(request: NextRequest) {
  try {
    // TODO: Add proper admin auth check here
    // For now, we'll rely on the dashboard's existing auth middleware
    
    console.log('🔄 Starting template sync via API...');
    
    const result = await seedHtmlLibraryTemplates();
    
    if (result.success) {
      return NextResponse.json({
        success: true,
        message: 'Templates synced successfully',
        templatesUpdated: result.results.length,
        results: result.results.map(r => ({
          id: r.id,
          title: r.title,
          created: r.created
        }))
      });
    } else {
      return NextResponse.json({
        success: false,
        message: 'Template sync completed with errors',
        templatesUpdated: result.results.length,
        errors: result.errors,
        results: result.results.map(r => ({
          id: r.id,
          title: r.title,
          created: r.created
        }))
      }, { status: 207 }); // 207 Multi-Status for partial success
    }
  } catch (error) {
    console.error('❌ Template sync failed:', error);
    return NextResponse.json({
      success: false,
      message: 'Template sync failed',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
