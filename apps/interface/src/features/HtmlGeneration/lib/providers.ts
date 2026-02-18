/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires */
/*
  AI generation provider implementations for HtmlGeneration feature.
  - Anthropic: uses fetch to call Messages API (no extra dep)
  - OpenAI: uses official openai SDK already in dependencies
*/

import { getLogger } from '@interface/lib/logger';
import { FunctionalPromptActions } from '@nia/prism';

import { recordStart, recordSuccess, recordError, generateOpId } from './diagnostics';

const log = getLogger('[html-generation.providers]');

interface ContentTypeInfo {
  name: string;
  type: string;
  description: string;
  jsonSchema: any;
  sampleData?: any;
}

interface ApiSchemaInfo {
  contentTypes: ContentTypeInfo[];
  tenantId: string;
  assistantName?: string;
}

/**
 * Fetches AppletStorage schema for applet data persistence
 * Always returns AppletStorage as the only content type
 */
export async function getApiSchemaInfo(tenantId: string, assistantName?: string): Promise<ApiSchemaInfo> {
  // Return AppletStorage content type schema for applet data persistence
  return {
    contentTypes: [{
      name: 'AppletStorage',
      type: 'AppletStorage',
      description: 'Free-form data storage for applets. Use this to save and retrieve any JSON data your applet needs.',
      jsonSchema: {
        type: 'object',
        properties: {
          _id: { 
            format: 'uuid', 
            type: 'string',
            description: 'Unique identifier for this storage record'
          },
          data: { 
            type: 'object',
            description: 'Your custom data - can be any JSON structure you need',
            additionalProperties: true
          },
          appletId: { 
            type: 'string',
            format: 'uuid',
            description: 'Reference to the applet that owns this data'
          },
          userId: { 
            type: 'string',
            description: 'User who owns this data'
          },
          createdAt: { 
            type: 'string', 
            format: 'date-time',
            description: 'When this record was created'
          },
          updatedAt: { 
            type: 'string', 
            format: 'date-time',
            description: 'When this record was last updated'
          }
        },
        required: ['data', 'appletId', 'userId']
      },
      sampleData: {
        data: {
          score: 100,
          level: 5,
          playerName: 'User123',
          inventory: ['sword', 'shield', 'potion']
        },
        appletId: '00000000-0000-0000-0000-000000000000',
        userId: 'user123'
      }
    }],
    tenantId,
    assistantName
  };
}

export async function generateWithAnthropic(
  prompt: string, 
  opts?: { 
    model?: string; 
    maxTokens?: number; 
    temperature?: number;
    apiSchemaInfo?: ApiSchemaInfo;
  opId?: string;
  }
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    log.error('Anthropic: Missing ANTHROPIC_API_KEY');
    throw new Error('Missing ANTHROPIC_API_KEY');
  }
  const model = opts?.model || process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022';
  const maxTokens = opts?.maxTokens ?? 8000; // Increased from 4000
  const temperature = opts?.temperature ?? 0.4;
  const opId = opts?.opId || generateOpId();
  const startedAt = Date.now();

  log.info('Anthropic request', { model, maxTokens, temperature, opId });

  // Enhance prompt with API schema information if provided
  const enhancedPrompt = opts?.apiSchemaInfo 
    ? await generateEnhancedPrompt(prompt, opts.apiSchemaInfo)
    : prompt;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      {
        role: 'user',
        content: enhancedPrompt,
      },
    ],
  } as const;

  recordStart(opId, { provider: 'anthropic', model, promptLength: enhancedPrompt.length });
  log.debug('Calling Anthropic API', { opId, model });
  const endpoint = 'https://api.anthropic.com/v1/messages';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  
  log.info('Anthropic response received', { status: res.status, statusText: res.statusText, opId, model });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.error('Anthropic API error', { status: res.status, statusText: res.statusText, body: text, opId, model });
    const err = new Error(`Anthropic request failed: ${res.status} ${res.statusText} ${text}`);
    recordError(opId, { provider: 'anthropic', model, error: err, endpoint, startedAt, headers: res.headers });
    throw err;
  }
  const json: any = await res.json();
  // Messages API returns { content: [{ type: 'text', text: '...' }, ...] }
  const parts: string[] = Array.isArray(json?.content)
    ? json.content.map((c: any) => (typeof c?.text === 'string' ? c.text : '')).filter(Boolean)
    : [];
  const text = parts.join('\n').trim();
  
  log.info('Anthropic response parsed', { length: text.length, opId, model });
  
  if (!text) {
    log.error('Anthropic response empty', { opId, model });
    const err = new Error('Anthropic response empty');
    recordError(opId, { provider: 'anthropic', model, error: err });
    throw err;
  }
  recordSuccess(opId, { responseLength: text.length, endpoint, status: res.status, headers: res.headers, startedAt });
  return text;
}

export async function generateWithOpenAI(
  prompt: string, 
  opts?: { 
    model?: string; 
    maxTokens?: number; 
    temperature?: number;
    apiSchemaInfo?: ApiSchemaInfo;
    opId?: string;
    reasoningEffort?: 'low' | 'medium' | 'high';
  }
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error('OpenAI: Missing OPENAI_API_KEY');
    throw new Error('Missing OPENAI_API_KEY');
  }
  const model = opts?.model || process.env.OPENAI_MODEL || 'gpt-5';
  const maxTokens = opts?.maxTokens ?? 8000; // Increased from 4000
  const temperature = opts?.temperature ?? 0.5;
  const opId = opts?.opId || generateOpId();
  const reasoningEffort = opts?.reasoningEffort;
  const startedAt = Date.now();

  log.info('OpenAI request', { model, maxTokens, temperature, reasoningEffort, opId });

  
  // Lazy import to avoid bundling in edge runtimes where not supported
  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ 
    apiKey,
  timeout: 600000, // 10 minute timeout for very long generations
  });

  // Enhance prompt with API schema information if provided
  const enhancedPrompt = opts?.apiSchemaInfo 
    ? await generateEnhancedPrompt(prompt, opts.apiSchemaInfo)
    : prompt;

  log.debug('Calling OpenAI API', { model, opId });
  try {
    // Determine which API to use:
    // - Responses API: gpt-5-codex, or any model with reasoningEffort set
    // - Chat Completions API: all other models
    const needsResponsesAPI = model === 'gpt-5-codex' || model === 'gpt-5.1-codex-max' || (reasoningEffort && model === 'gpt-5');
    const isGpt5Model = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'o3'].includes(model);
    
    recordStart(opId, { provider: 'openai', model, promptLength: enhancedPrompt.length });
    const openaiCallStart = Date.now();
    
    let text: string | undefined;
    
    if (needsResponsesAPI) {
      // Use Responses API for gpt-5-codex and gpt-5 with reasoning
      log.info('Using OpenAI Responses API', { model, reasoningEffort, opId });
      
      const responsesConfig: any = {
        model,
        input: [
          { role: 'system', content: 'You are an expert front-end engineer who outputs only complete, self-contained HTML documents.' },
          { role: 'user', content: enhancedPrompt },
        ],
      };
      
      if (reasoningEffort) {
        responsesConfig.reasoning = { effort: reasoningEffort };
        log.info('Applying reasoning effort for OpenAI Responses API', { model, reasoningEffort, opId });
      }
      
      // Use any type for response as OpenAI SDK Responses API types may not be fully exported yet
      const response: any = await client.responses.create(responsesConfig);
      const durationMs = Date.now() - openaiCallStart;
      log.debug('OpenAI Responses API call completed', { model, opId, durationMs });
      
      // Parse response from Responses API format
      // The response format can be: { output_text } or { content: [{ text }] }
      if (response.output_text) {
        text = response.output_text.toString().trim();
      } else if (response.content && Array.isArray(response.content) && response.content.length > 0) {
        text = response.content[0].text?.toString().trim();
      }
    } else {
      // Use Chat Completions API for standard models
      log.info('Using OpenAI Chat Completions API', { model, opId });
      
      const requestConfig: any = {
        model,
        messages: [
          { role: 'system', content: 'You are an expert front-end engineer who outputs only complete, self-contained HTML documents.' },
          { role: 'user', content: enhancedPrompt },
        ],
      };

      if (isGpt5Model) {
        // For GPT-5 models, temperature defaults to 1 and is often the only supported value
        log.debug('Using model default max_completion_tokens for GPT-5', { model, opId });
      } else {
        requestConfig.temperature = temperature;
        requestConfig.max_tokens = maxTokens;
        log.debug('Configured Chat Completions request', { model, opId, maxTokens, temperature });
      }
      
      const completion = await client.chat.completions.create(requestConfig);
      const durationMs = Date.now() - openaiCallStart;
      log.debug('OpenAI Chat Completions call completed', { model, opId, durationMs });
      
      text = completion.choices?.[0]?.message?.content?.toString().trim();
    }
    
    if (!text) {
      log.error('OpenAI returned an empty response', { model, opId, api: needsResponsesAPI ? 'Responses' : 'Chat Completions' });
      
      const err = new Error(`OpenAI response empty for model ${model}. This might indicate a content policy violation, model availability issue, or API parameter problem.`);
      recordError(opId, { provider: 'openai', model, error: err });
      throw err;
    }
    
    log.info('OpenAI response parsed', { length: text.length, model, opId });
    const endpoint = needsResponsesAPI ? 'openai:responses.create' : 'openai:chat.completions.create';
    recordSuccess(opId, { responseLength: text.length, endpoint, status: 200, headers: {}, startedAt });
    return text;
  } catch (openaiError: any) {
    log.error('OpenAI API call failed', {
      message: openaiError?.message,
      code: openaiError?.code,
      type: openaiError?.type,
      opId,
      model,
      error: openaiError
    });
    
    // Check if it's a timeout issue
    if (openaiError.name === 'TimeoutError' || openaiError.message?.includes('timeout')) {
      log.warn('Request timed out for OpenAI model', { model, opId });
      throw new Error(`Request timed out for model ${model}. The API may be experiencing high load.`);
    }
    
    // Check if it's a model availability issue
    if (openaiError.code === 'model_not_found' || openaiError.message?.includes('does not exist')) {
      log.warn('OpenAI model not available', { model, opId });
      throw new Error(`Model ${model} is not available. It may be a preview model or not yet released to your account.`);
    }
    
    // Check if it's a parameter issue
    if (openaiError.code === 'invalid_request_error' || openaiError.type === 'invalid_request_error') {
      log.warn('Invalid OpenAI request parameters', { model, opId });
      if (openaiError.message?.includes('temperature')) {
        throw new Error(`Temperature parameter issue with model ${model}. GPT-5 models only support temperature=1.`);
      }
    }
    
    // Check for network/connection issues
    if (openaiError.code === 'ECONNRESET' || openaiError.code === 'ENOTFOUND' || openaiError.message?.includes('network')) {
      log.warn('Network error occurred with OpenAI model', { model, opId, code: openaiError.code });
      throw new Error(`Network error occurred while calling OpenAI API with model ${model}.`);
    }
    
  recordError(opId, { provider: 'openai', model, error: openaiError, endpoint: 'openai:chat.completions.create', startedAt });
  throw openaiError;
  }
}

// Gemini provider (Google Generative Language API)
export async function generateWithGemini(
  prompt: string,
  opts?: { 
    model?: string; 
    maxTokens?: number; 
    temperature?: number;
  apiSchemaInfo?: ApiSchemaInfo;
  opId?: string;
  }
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    log.error('Gemini: Missing GEMINI_API_KEY');
    throw new Error('Missing GEMINI_API_KEY');
  }
  const model = opts?.model || process.env.GEMINI_MODEL || 'gemini-2.5-pro';
  const temperature = opts?.temperature ?? 0.5;
  const maxOutputTokens = opts?.maxTokens ?? 8000;
  const opId = opts?.opId || generateOpId();
  const startedAt = Date.now();

  log.info('Gemini request', { model, maxTokens: maxOutputTokens, temperature, opId });

  // Enhance prompt with API schema information if provided
  const enhancedPrompt = opts?.apiSchemaInfo 
    ? await generateEnhancedPrompt(prompt, opts.apiSchemaInfo)
    : prompt;

  log.debug('Calling Gemini API', { model, opId });

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    generationConfig: { temperature, maxOutputTokens },
    contents: [
      {
        role: 'user',
        parts: [{ text: enhancedPrompt }],
      },
    ],
  } as const;

  log.info('Calling Gemini API', { model, opId });
  recordStart(opId, { provider: 'gemini', model, promptLength: enhancedPrompt.length });
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  
  log.info('Gemini response received', { status: res.status, statusText: res.statusText, model, opId });
  
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    log.error('Gemini API error', { status: res.status, statusText: res.statusText, body: text, model, opId });
    const err = new Error(`Gemini request failed: ${res.status} ${res.statusText} ${text}`);
    recordError(opId, { provider: 'gemini', model, error: err, endpoint, startedAt, headers: res.headers });
    throw err;
  }
  const json: any = await res.json();
  const candidate = json?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  const text = parts.map((p: any) => p?.text).filter(Boolean).join('\n').trim();
  
  log.info('Gemini response parsed', { length: text.length, model, opId });
  
  if (!text) {
    log.error('Gemini response empty', { model, opId });
    const err = new Error('Gemini response empty');
    recordError(opId, { provider: 'gemini', model, error: err });
    throw err;
  }
  recordSuccess(opId, { responseLength: text.length, endpoint, status: res.status, headers: res.headers, startedAt });
  return text;
}

export function stripCodeFences(html: string): string {
  // Remove ``` or ```html fences and surrounding whitespace
  return html
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/**
 * Interpolate template variables in a prompt string
 * Supports: {{variable}}, {{#variable}}...{{/variable}} (conditional blocks)
 */
function interpolatePromptTemplate(
  template: string,
  vars: Record<string, string | boolean | undefined>
): string {
  let result = template;

  // Handle conditional blocks: {{#variable}}content{{/variable}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
    const value = vars[key];
    // Include block if value is truthy
    return value ? content : '';
  });

  // Handle simple variable substitution: {{variable}}
  result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = vars[key];
    return value !== undefined && value !== null ? String(value) : '';
  });

  return result;
}

/**
 * Generate enhanced prompt by fetching appletApi template from database and interpolating variables
 */
async function generateEnhancedPrompt(originalPrompt: string, apiInfo: ApiSchemaInfo): Promise<string> {
  try {
    // Fetch the appletApi functional prompt from database
    const appletApiPrompt = await FunctionalPromptActions.findByFeatureKey('appletApi');
    
    if (!appletApiPrompt || !appletApiPrompt.promptContent) {
      log.warn('appletApi prompt not found in database, skipping API integration instructions');
      return originalPrompt;
    }

    log.info('Retrieved appletApi template from database');

    // Interpolate template variables (no contentType needed - API is hardcoded to AppletStorage)
    const interpolatedPrompt = interpolatePromptTemplate(appletApiPrompt.promptContent, {
      tenantId: apiInfo.tenantId,
      assistantName: apiInfo.assistantName,
    });

    // Combine original prompt with enhanced API instructions
    return `${originalPrompt}\n\n${interpolatedPrompt}`;
  } catch (error) {
    log.error('Error generating enhanced prompt', { err: error });
    // Fallback to original prompt without API instructions
    return originalPrompt;
  }
}
