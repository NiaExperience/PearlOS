import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_switch_layout_mode]');

const VALID_MODES = ['auto', 'desktop', 'mobile'] as const;
type LayoutMode = typeof VALID_MODES[number];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode } = body;

    if (!mode || !VALID_MODES.includes(mode as LayoutMode)) {
      return NextResponse.json(
        {
          error: 'Invalid mode specified',
          validModes: VALID_MODES,
          message: `Please specify one of: ${VALID_MODES.join(', ')}`,
        },
        { status: 400 },
      );
    }

    log.info('Layout mode switch requested', { mode });

    return NextResponse.json({
      success: true,
      mode,
      message: `Successfully switched to ${mode} layout mode`,
      timestamp: new Date().toISOString(),
      action: 'SWITCH_LAYOUT_MODE',
      payload: { mode },
    });
  } catch (error) {
    log.error('Error in switch-layout-mode API', { error });
    return NextResponse.json(
      { error: 'Failed to process layout mode switch' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Layout Mode Switcher API',
    availableModes: VALID_MODES,
    usage: 'POST { mode: "desktop" | "mobile" | "auto" }',
  });
}
