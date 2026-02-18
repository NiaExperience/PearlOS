import { NextRequest, NextResponse } from 'next/server';

/**
 * Basic health check endpoint
 * Returns simple status information for load balancer health checks
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'dashboard',
      version: process.env.npm_package_version || 'unknown',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'unknown'
    };

    return NextResponse.json(health, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
  } catch (error) {
    return NextResponse.json(
      { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
        service: 'dashboard'
      }, 
      { status: 503 }
    );
  }
}

/**
 * Also support HEAD requests for basic connectivity checks
 */
export async function HEAD(_request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, { status: 200 });
}