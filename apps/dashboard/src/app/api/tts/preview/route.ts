// Disable ws native bindings BEFORE requiring the module
// This prevents the "bufferUtil.mask is not a function" error in Next.js serverless
process.env.WS_NO_BUFFER_UTIL = '1';
process.env.WS_NO_UTF_8_VALIDATE = '1';

import { NextRequest, NextResponse } from 'next/server';

// Use require() after setting env vars to ensure they're respected
// Type inline to avoid import triggering module resolution before env vars are set
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any, @typescript-eslint/no-var-requires
const WebSocket: any = require('ws');

/**
 * TTS Preview API
 *
 * Synthesizes a short voice sample using either ElevenLabs or Kokoro/Chorus TTS.
 * Returns the audio as a binary response that can be played directly via <audio> element.
 *
 * POST /api/tts/preview
 * Body: {
 *   provider: '11labs' | 'kokoro',
 *   voiceId: string,
 *   personaName?: string,
 *   stability?: number,
 *   similarityBoost?: number,
 *   style?: number,
 *   speed?: number
 * }
 */

interface TTSPreviewRequest {
  provider: '11labs' | 'kokoro';
  voiceId: string;
  personaName?: string;
  text?: string;
  stability?: number;
  similarityBoost?: number;
  style?: number;
  speed?: number;
}

export async function POST(request: NextRequest) {
  try {
    const body: TTSPreviewRequest = await request.json();
    const { provider, voiceId, personaName, text, stability, similarityBoost, style, speed } = body;

    if (!provider || !voiceId) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, voiceId' },
        { status: 400 }
      );
    }

    // Generate sample text with persona name
    const sampleText =
      text || `Hello, this is ${personaName || 'your assistant'}. What are we creating today?`;

    // Normalize provider names
    if (provider === '11labs') {
      return await synthesizeElevenLabs({
        voiceId,
        text: sampleText,
        stability: stability ?? 0.5,
        similarityBoost: similarityBoost ?? 0.5,
        style: style ?? 0,
        speed: speed ?? 1,
      });
    } else if (provider === 'kokoro') {
      return await synthesizeKokoro({
        voiceId,
        text: sampleText,
        speed: speed ?? 1,
        stability: stability ?? 0.5,
        similarityBoost: similarityBoost ?? 0.5,
        style: style ?? 0,
      });
    }

    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
  } catch (error) {
    console.error('[TTS Preview] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to synthesize audio' },
      { status: 500 }
    );
  }
}

/**
 * Synthesize using ElevenLabs REST API
 */
async function synthesizeElevenLabs(params: {
  voiceId: string;
  text: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
}): Promise<NextResponse> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
  }

  console.log('[TTS Preview] ElevenLabs params:', {
    voiceId: params.voiceId,
    stability: params.stability,
    similarityBoost: params.similarityBoost,
    style: params.style,
    speed: params.speed,
  });

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${params.voiceId}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text: params.text,
      model_id: 'eleven_turbo_v2_5',
      voice_settings: {
        stability: params.stability,
        similarity_boost: params.similarityBoost,
        style: params.style,
        speed: params.speed, // Speed is part of voice_settings in v1 API
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('[TTS Preview] ElevenLabs error:', response.status, errorText);
    return NextResponse.json(
      { error: `ElevenLabs API error: ${response.status}` },
      { status: response.status }
    );
  }

  const audioBuffer = await response.arrayBuffer();

  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.byteLength.toString(),
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Synthesize using Kokoro/Chorus TTS via WebSocket
 *
 * The Chorus TTS service speaks an ElevenLabs-compatible WebSocket protocol.
 * We connect, send text, collect audio chunks, and return as PCM audio.
 */
async function synthesizeKokoro(params: {
  voiceId: string;
  text: string;
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
}): Promise<NextResponse> {
  const chorusUrl = process.env.KOKORO_TTS_BASE_URL || process.env.CHORUS_TTS_URL;
  const apiKey = process.env.KOKORO_TTS_API_KEY || process.env.CHORUS_TTS_API_KEY;

  if (!chorusUrl) {
    return NextResponse.json({ error: 'Chorus TTS URL not configured' }, { status: 500 });
  }

  // Build WebSocket URL
  // Chorus expects: ws://host:port/v1/text-to-speech/{voice_id}/stream-input
  const wsUrl = buildKokoroWebSocketUrl(chorusUrl, params.voiceId, apiKey);

  try {
    const audioChunks = await streamKokoroTTS(wsUrl, params.text, {
      stability: params.stability,
      similarity_boost: params.similarityBoost,
      style: params.style,
      speed: params.speed,
    });

    // Convert PCM chunks to a playable WAV format
    const wavBuffer = pcmToWav(audioChunks, 24000); // Kokoro outputs 24kHz PCM

    return new NextResponse(wavBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': wavBuffer.byteLength.toString(),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('[TTS Preview] Kokoro error:', error);
    return NextResponse.json(
      { error: `Kokoro TTS error: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}

/**
 * Build Kokoro WebSocket URL
 */
function buildKokoroWebSocketUrl(
  baseUrl: string,
  voiceId: string,
  apiKey?: string
): string {
  // Convert http/https to ws/wss
  let wsUrl = baseUrl.replace(/^http/, 'ws');

  // Remove trailing slash
  wsUrl = wsUrl.replace(/\/$/, '');

  // Append the TTS path
  wsUrl = `${wsUrl}/v1/text-to-speech/${voiceId}/stream-input`;

  // Add api_key as query param if provided
  if (apiKey) {
    wsUrl += `?api_key=${encodeURIComponent(apiKey)}&output_format=pcm_24000`;
  } else {
    wsUrl += '?output_format=pcm_24000';
  }

  return wsUrl;
}

/**
 * Stream TTS from Kokoro via WebSocket and collect audio chunks
 * 
 * Protocol (matches ElevenLabs WebSocket API):
 * 1. Connect to ws://host/v1/text-to-speech/{voice_id}/stream-input
 * 2. Receive "connected" event
 * 3. Send init message {"text": " "} (single space)
 * 4. Send text chunks {"text": "...", "flush": true}
 * 5. Send close signal {"text": ""} to indicate done sending
 * 6. Receive "audioOutput" events with base64 audio
 * 7. Receive "finalOutput" event when synthesis complete
 */
async function streamKokoroTTS(
  wsUrl: string,
  text: string,
  voiceSettings: {
    stability: number;
    similarity_boost: number;
    style: number;
    speed: number;
  }
): Promise<Uint8Array[]> {
  return new Promise((resolve, reject) => {
    console.log('[TTS Preview] Connecting to Kokoro:', wsUrl.replace(/api_key=[^&]+/, 'api_key=***'));
    
    const ws = new WebSocket(wsUrl);
    const audioChunks: Uint8Array[] = [];
    let connected = false;
    let resolved = false;
    let receivedConnected = false;

    // Connection timeout (10s to connect)
    const connectTimeout = setTimeout(() => {
      if (!connected) {
        console.error('[TTS Preview] WebSocket connection timeout');
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }
    }, 10000);

    // Overall timeout (30s for entire synthesis) 
    const synthesisTimeout = setTimeout(() => {
      if (!resolved) {
        console.error('[TTS Preview] Synthesis timeout - no audio received');
        ws.close();
        reject(new Error('Synthesis timeout'));
      }
    }, 30000);

    const cleanup = () => {
      clearTimeout(connectTimeout);
      clearTimeout(synthesisTimeout);
    };

    ws.on('open', () => {
      connected = true;
      clearTimeout(connectTimeout);
      console.log('[TTS Preview] WebSocket connected, waiting for "connected" event');
    });

    ws.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      try {
        // Handle different data formats
        let msgStr: string;
        if (typeof data === 'string') {
          msgStr = data;
        } else if (Buffer.isBuffer(data)) {
          msgStr = data.toString();
        } else if (data instanceof ArrayBuffer) {
          msgStr = new TextDecoder().decode(data);
        } else {
          return; // Unknown format
        }
        
        const msg = JSON.parse(msgStr);
        console.log('[TTS Preview] Received event:', msg.event);

        if (msg.event === 'connected') {
          receivedConnected = true;
          
          // Step 1: Send initialization message (single space)
          console.log('[TTS Preview] Sending init message');
          ws.send(JSON.stringify({
            text: ' ',
            voice_settings: voiceSettings,
          }));
          
          // Step 2: Send actual text with flush
          console.log('[TTS Preview] Sending text:', text.substring(0, 50) + '...');
          ws.send(JSON.stringify({
            text: text,
            flush: true,
          }));
          
          // Step 3: Send close signal to indicate we're done sending text
          console.log('[TTS Preview] Sending close signal');
          ws.send(JSON.stringify({ text: '' }));
          
        } else if (msg.event === 'audioOutput') {
          // Decode base64 audio chunk
          const audioData = Buffer.from(msg.audio, 'base64');
          audioChunks.push(new Uint8Array(audioData));
          console.log('[TTS Preview] Received audio chunk:', audioData.length, 'bytes');
          
        } else if (msg.event === 'finalOutput') {
          // Synthesis complete
          console.log('[TTS Preview] Synthesis complete, received', audioChunks.length, 'chunks');
          ws.close();
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve(audioChunks);
          }
          
        } else if (msg.event === 'error') {
          console.error('[TTS Preview] Server error:', msg.message);
          ws.close();
          if (!resolved) {
            resolved = true;
            cleanup();
            reject(new Error(msg.message || 'Kokoro TTS error'));
          }
        }
      } catch {
        // May be binary data, ignore parse errors
      }
    });

    ws.on('error', (err: Error) => {
      console.error('[TTS Preview] WebSocket error:', err.message);
      cleanup();
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || 'unknown';
      console.log('[TTS Preview] WebSocket closed:', code, reasonStr);
      cleanup();
      if (!resolved) {
        resolved = true;
        if (audioChunks.length > 0) {
          resolve(audioChunks);
        } else if (!receivedConnected) {
          reject(new Error(`Connection failed: ${code} ${reasonStr}`));
        } else {
          reject(new Error('Connection closed without receiving audio'));
        }
      }
    });
  });
}

/**
 * Convert raw PCM data to WAV format
 */
function pcmToWav(chunks: Uint8Array[], sampleRate: number): ArrayBuffer {
  // Concatenate all PCM chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const pcmData = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    pcmData.set(chunk, offset);
    offset += chunk.length;
  }

  // Create WAV header
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, 'WAVE');

  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Copy PCM data
  const wavData = new Uint8Array(buffer);
  wavData.set(pcmData, headerSize);

  return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
