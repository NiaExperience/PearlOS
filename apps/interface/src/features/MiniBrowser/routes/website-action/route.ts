import { NextRequest, NextResponse } from 'next/server';
import { VoiceNavigator, generateBrowserScript } from '../../services/voice-navigator';

export async function POST(request: NextRequest) {
  try {
    const { command, scrapedData, url } = await request.json();
    const navigator = new VoiceNavigator(scrapedData);
    const parsed = navigator.parseVoiceCommand(command);
    const result = await navigator.executeCommand(parsed);
    const script = generateBrowserScript(result, parsed);
    return NextResponse.json({ success: result.success, message: result.message, action: result.action, element: result.element, script, parsedCommand: parsed });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: 'Failed to process website action', message: String(e?.message || e) }, { status: 500 });
  }
}


