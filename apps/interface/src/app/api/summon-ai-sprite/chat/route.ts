import { NextRequest, NextResponse } from 'next/server';

import { getLogger } from '@nia/prism/core/logger';

const log = getLogger('api:summon-ai-sprite:chat');
const OLLAMA_MODEL = 'mistral';
const OPENAI_MODEL = 'anthropic/claude-sonnet-4-5';

function buildSystemPrompt(characterPrompt: string) {
    return [
        'You are a pixel sprite character.',
        `Character description: ${characterPrompt}`,
        'Reply concisely (1-3 sentences).',
        'Stay in persona (doctor/painter/etc. as described).',
        'Do not include speech bubbles, emoji, ASCII art, or code.',
    ].join(' ');
}

type LLMProvider = 'ollama' | 'openai';

interface LLMConfig {
    provider: LLMProvider;
    baseUrl: string;
    model: string;
    apiKey?: string;
}

function getLLMConfig(): LLMConfig | null {
    // Try Ollama first
    const ollamaUrl = process.env.OLLAMA_BASE_URL || process.env.SPRITE_CHAT_LLM_URL;
    if (ollamaUrl) {
        return {
            provider: 'ollama',
            baseUrl: ollamaUrl.endsWith('/') ? ollamaUrl.slice(0, -1) : ollamaUrl,
            model: OLLAMA_MODEL,
        };
    }
    
    // Prefer OpenClaw (Claude) over OpenAI
    const openclawKey = process.env.OPENCLAW_API_KEY;
    if (openclawKey) {
        return {
            provider: 'openai',
            baseUrl: process.env.OPENCLAW_API_URL || 'http://localhost:18789/v1',
            model: OPENAI_MODEL,
            apiKey: openclawKey,
        };
    }

    // Fall back to OpenAI
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
        return {
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            model: OPENAI_MODEL,
            apiKey: openaiKey,
        };
    }
    
    return null;
}

async function callOllama(config: LLMConfig, systemPrompt: string, message: string): Promise<string> {
    const res = await fetch(`${config.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: config.model,
            stream: false,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
            ],
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Ollama request failed: ${res.status} - ${text.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);
    const reply = data?.message?.content;
    
    if (!reply || typeof reply !== 'string') {
        throw new Error('Invalid Ollama response structure');
    }
    
    return reply;
}

async function callOpenAI(config: LLMConfig, systemPrompt: string, message: string): Promise<string> {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: message },
            ],
        }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI request failed: ${res.status} - ${text.slice(0, 200)}`);
    }

    const data = await res.json().catch(() => null);
    const reply = data?.choices?.[0]?.message?.content;
    
    if (!reply || typeof reply !== 'string') {
        throw new Error('Invalid OpenAI response structure');
    }
    
    return reply;
}

export async function POST(request: NextRequest) {
    log.info('Chat request received');
    
    try {
        const body = await request.json().catch(() => null);
        const rawPrompt = typeof body?.prompt === 'string' ? body.prompt : '';
        const characterPrompt = rawPrompt.trim();
        const rawMessage = typeof body?.message === 'string' ? body.message : '';
        const message = rawMessage.trim();

        log.info('Parsed request body', {
            hasPrompt: !!characterPrompt,
            promptLength: characterPrompt.length,
            hasMessage: !!message,
            messageLength: message.length,
        });

        if (!characterPrompt) {
            log.warn('Missing prompt in request');
            return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
        }
        if (!message) {
            log.warn('Missing message in request');
            return NextResponse.json({ error: 'message is required' }, { status: 400 });
        }

        const llmConfig = getLLMConfig();
        if (!llmConfig) {
            log.error('No LLM provider configured (need OLLAMA_BASE_URL or OPENAI_API_KEY)');
            return NextResponse.json({ error: 'No LLM provider configured' }, { status: 500 });
        }
        
        log.info('LLM config', { provider: llmConfig.provider, model: llmConfig.model });

        const systemPrompt = buildSystemPrompt(characterPrompt);

        log.info('Calling LLM', {
            provider: llmConfig.provider,
            systemPromptLength: systemPrompt.length,
            userMessageLength: message.length,
        });

        let reply: string;
        if (llmConfig.provider === 'ollama') {
            reply = await callOllama(llmConfig, systemPrompt, message);
        } else {
            reply = await callOpenAI(llmConfig, systemPrompt, message);
        }

        log.info('Chat successful', { provider: llmConfig.provider, replyLength: reply.length });
        return NextResponse.json({ reply });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const stack = err instanceof Error ? err.stack : undefined;
        log.error('Unexpected error in sprite chat', { message, stack });
        return NextResponse.json({ error: 'Unexpected error', details: message }, { status: 500 });
    }
}
