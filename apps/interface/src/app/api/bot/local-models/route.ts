import { NextResponse } from 'next/server';
import { getLogger } from '@interface/lib/logger';

const log = getLogger('[api_local_models]');

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

interface OllamaTagsResponse {
  models: OllamaModel[];
}

export async function GET() {
  try {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    const res = await fetch(`${ollamaUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      log.warn('Ollama not reachable: ' + res.status);
      return NextResponse.json({ models: [], available: false });
    }

    const data: OllamaTagsResponse = await res.json();
    const models = (data.models || []).map((m) => ({
      name: m.name,
      modelId: `ollama/${m.name}`,
      size: m.size,
      parameterSize: m.details?.parameter_size || null,
      family: m.details?.family || null,
      quantization: m.details?.quantization_level || null,
      modifiedAt: m.modified_at,
    }));

    return NextResponse.json({ models, available: true });
  } catch (err) {
    log.warn('Ollama discovery failed: ' + String(err));
    return NextResponse.json({ models: [], available: false });
  }
}
