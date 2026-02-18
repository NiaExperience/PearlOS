import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_switch_desktop_mode]');

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, userRequest } = body;

    // Validate the mode parameter
    const validModes = ['home', 'work', 'creative', 'gaming', 'focus', 'relaxation'];
    
    if (!mode || !validModes.includes(mode)) {
      return NextResponse.json(
        { 
          error: 'Invalid mode specified',
          validModes,
          message: `Please specify one of: ${validModes.join(', ')}`
        },
        { status: 400 }
      );
    }

    // Log the mode switch request
    log.info('Desktop mode switch requested', { mode, userRequest: userRequest || undefined });

    // Return success response with mode information
    const response = {
      success: true,
      mode: mode,
      message: `Successfully switched to ${mode} mode`,
      userRequest: userRequest || null,
      timestamp: new Date().toISOString(),
      // This will be sent to the frontend for handling the actual mode switch
      action: 'SWITCH_DESKTOP_MODE',
      payload: {
        targetMode: mode,
        previousMode: null, // Could be tracked if needed
        switchReason: userRequest || 'Voice command'
      }
    };

    return NextResponse.json(response);

  } catch (error) {
    log.error('Error in switch-desktop-mode API', { error, mode: undefined });
    
    return NextResponse.json(
      {
        error: 'Failed to process desktop mode switch',
        message: 'An internal error occurred while processing the mode switch request'
      },
      { status: 500 }
    );
  }
}

// Handle GET requests for testing
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode');
  
  if (!mode) {
    return NextResponse.json({
      message: 'Desktop Mode Switcher API',
      availableModes: ['home', 'work', 'creative', 'gaming', 'focus', 'relaxation'],
      usage: 'POST request with { mode: "work" } to switch modes'
    });
  }

  // Simulate a mode switch for testing
  return NextResponse.json({
    success: true,
    mode: mode,
    message: `Test mode switch to ${mode}`,
    action: 'SWITCH_DESKTOP_MODE',
    payload: {
      targetMode: mode,
      switchReason: 'API test'
    }
  });
} 