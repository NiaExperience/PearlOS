import { NextRequest, NextResponse } from 'next/server';

/**
 * Deep health check endpoint that verifies dependencies
 * Returns detailed health information including dependent services
 */
export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const checks = {
      service: 'healthy',
      mesh: 'unknown',
      database: 'unknown'
    };

    let overallStatus = 'healthy';
    
    // Check mesh connectivity if endpoint is configured
    if (process.env.MESH_ENDPOINT) {
      try {
        const meshHealthUrl = process.env.MESH_ENDPOINT.replace('/graphql', '/health');
        
        // Create an AbortController for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const meshResponse = await fetch(meshHealthUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'dashboard-healthcheck/1.0'
          }
        });
        
        clearTimeout(timeoutId);
        checks.mesh = meshResponse.ok ? 'healthy' : 'unhealthy';
        
        if (!meshResponse.ok) {
          overallStatus = 'degraded';
        }
      } catch (error) {
        checks.mesh = 'unhealthy';
        overallStatus = 'degraded';
      }
    }

    const health = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      service: 'dashboard',
      version: process.env.npm_package_version || 'unknown',
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'unknown',
      checks
    };

    const statusCode = overallStatus === 'healthy' ? 200 : 503;

    return NextResponse.json(health, { 
      status: statusCode,
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
        service: 'dashboard',
        checks: { service: 'unhealthy' }
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