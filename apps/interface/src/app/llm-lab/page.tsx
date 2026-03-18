"use client";

import React, { useState, useRef, useEffect } from 'react';

// ────────────────────────────────────────────────────────────
// Types & Interfaces
// ────────────────────────────────────────────────────────────

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    model?: string;
    latency?: number;
    tokens?: number;
  };
}

interface Config {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  topP: number;
}

interface Preset {
  name: string;
  config: Partial<Config>;
  emoji: string;
}

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Config = {
  provider: 'Anthropic',
  model: 'anthropic/claude-sonnet-4-5',
  temperature: 1,
  maxTokens: 4096,
  systemPrompt: 'You are a helpful AI assistant.',
  topP: 1,
};

const PROVIDERS = ['Anthropic', 'OpenRouter', 'Groq'];

const MODEL_PRESETS = [
  { label: 'Haiku 3.5', value: 'anthropic/claude-haiku-4-5' },
  { label: 'Sonnet 3.5', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Opus', value: 'anthropic/claude-opus-4-6' },
  { label: 'Groq Llama', value: 'groq/llama-3.3-70b-versatile' },
  { label: 'Gemini Flash', value: 'google/gemini-2.0-flash-001' },
];

const PRESETS: Preset[] = [
  {
    name: 'Fast',
    emoji: '⚡',
    config: {
      model: 'anthropic/claude-haiku-4-5',
      temperature: 0.3,
      maxTokens: 2048,
    },
  },
  {
    name: 'Balanced',
    emoji: '⚖️',
    config: {
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 0.7,
      maxTokens: 4096,
    },
  },
  {
    name: 'Deep',
    emoji: '🧠',
    config: {
      model: 'anthropic/claude-opus-4-6',
      temperature: 0.5,
      maxTokens: 8192,
    },
  },
  {
    name: 'Creative',
    emoji: '🎨',
    config: {
      model: 'anthropic/claude-sonnet-4-5',
      temperature: 1.2,
      maxTokens: 4096,
    },
  },
  {
    name: 'Speed',
    emoji: '🚀',
    config: {
      model: 'groq/llama-3.3-70b-versatile',
      temperature: 0.5,
      maxTokens: 4096,
    },
  },
];

// ────────────────────────────────────────────────────────────
// Main Component
// ────────────────────────────────────────────────────────────

export default function LLMLabPage() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ──────────────────────────────────────────────────────────
  // Handlers
  // ──────────────────────────────────────────────────────────

  const applyPreset = (preset: Preset) => {
    setConfig((prev) => ({ ...prev, ...preset.config }));
  };

  const resetConfig = () => {
    setConfig(DEFAULT_CONFIG);
  };

  const clearChat = () => {
    setMessages([]);
  };

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    const startTime = Date.now();

    try {
      // Build conversation history
      const conversationMessages = [
        ...(config.systemPrompt
          ? [{ role: 'system' as const, content: config.systemPrompt }]
          : []),
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: 'user' as const, content: userMessage.content },
      ];

      const response = await fetch('http://localhost:18789/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: conversationMessages,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          top_p: config.topP,
          stream: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('No response body');
      }

      let assistantContent = '';
      let assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        metadata: {
          model: config.model,
        },
      };

      setMessages((prev) => [...prev, assistantMessage]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter((line) => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta?.content;

              if (delta) {
                assistantContent += delta;
                setMessages((prev) => {
                  const newMessages = [...prev];
                  const lastMessage = newMessages[newMessages.length - 1];
                  if (lastMessage.role === 'assistant') {
                    lastMessage.content = assistantContent;
                  }
                  return newMessages;
                });
              }

              // Extract usage info if available
              if (parsed.usage?.total_tokens) {
                assistantMessage.metadata = {
                  ...assistantMessage.metadata,
                  tokens: parsed.usage.total_tokens,
                };
              }
            } catch (e) {
              console.warn('Failed to parse SSE chunk:', e);
            }
          }
        }
      }

      const latency = Date.now() - startTime;
      setMessages((prev) => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage.role === 'assistant') {
          lastMessage.metadata = {
            ...lastMessage.metadata,
            latency,
          };
        }
        return newMessages;
      });
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: Message = {
        role: 'system',
        content: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsStreaming(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ──────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col lg:flex-row h-screen w-screen bg-[#0f0820] text-white overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-purple-900/40 to-cyan-900/40 backdrop-blur-sm border-b border-purple-500/20 lg:hidden">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            LLM Lab
          </h1>
          <span className="px-3 py-1 text-xs bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">
            ⚠️ Sandbox
          </span>
        </div>
        <button
          onClick={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          className="lg:hidden px-4 py-2 bg-purple-600/30 hover:bg-purple-600/50 rounded-lg border border-purple-500/30 transition-all"
        >
          {isMobileSidebarOpen ? '✕ Close' : '⚙️ Config'}
        </button>
      </div>

      {/* Left Sidebar - Configuration Panel */}
      <div
        className={`
          ${isMobileSidebarOpen ? 'block' : 'hidden'} lg:block
          w-full lg:w-96 bg-gradient-to-b from-[#1a0f2e] to-[#0f0820] 
          border-r border-purple-500/20 overflow-y-auto
          absolute lg:relative z-10 h-[calc(100vh-64px)] lg:h-screen
        `}
      >
        <div className="p-6 space-y-6">
          {/* Header - Desktop Only */}
          <div className="hidden lg:block">
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
                LLM Lab
              </h1>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <span className="text-amber-400 text-sm">⚠️ Sandbox — not connected to production</span>
            </div>
          </div>

          {/* Presets */}
          <div>
            <h3 className="text-sm font-semibold text-purple-300 mb-3">Quick Presets</h3>
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => applyPreset(preset)}
                  className="px-3 py-2 bg-purple-600/20 hover:bg-purple-600/40 rounded-lg border border-purple-500/30 transition-all text-sm font-medium"
                >
                  {preset.emoji} {preset.name}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />

          {/* Provider */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">Provider</label>
            <select
              value={config.provider}
              onChange={(e) => setConfig({ ...config, provider: e.target.value })}
              className="w-full px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">Model</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              className="w-full px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 mb-2"
              placeholder="Enter model name..."
            />
            <div className="flex flex-wrap gap-2">
              {MODEL_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  onClick={() => setConfig({ ...config, model: preset.value })}
                  className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-600/40 rounded border border-cyan-500/30 text-xs transition-all"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Temperature */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">
              Temperature: {config.temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={config.temperature}
              onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) })}
              className="w-full h-2 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-xs text-purple-400 mt-1">
              <span>Precise</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">Max Tokens</label>
            <input
              type="number"
              value={config.maxTokens}
              onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || 4096 })}
              className="w-full px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              min="1"
              max="200000"
            />
          </div>

          {/* Top P */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">
              Top P: {config.topP.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={config.topP}
              onChange={(e) => setConfig({ ...config, topP: parseFloat(e.target.value) })}
              className="w-full h-2 bg-purple-900/30 rounded-lg appearance-none cursor-pointer accent-cyan-500"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="block text-sm font-semibold text-purple-300 mb-2">System Prompt</label>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              className="w-full px-4 py-2 bg-purple-900/30 border border-purple-500/30 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y min-h-[100px]"
              placeholder="Enter system prompt..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={resetConfig}
              className="flex-1 px-4 py-2 bg-slate-600/30 hover:bg-slate-600/50 rounded-lg border border-slate-500/30 transition-all font-medium"
            >
              Reset
            </button>
            <button
              onClick={clearChat}
              className="flex-1 px-4 py-2 bg-red-600/30 hover:bg-red-600/50 rounded-lg border border-red-500/30 transition-all font-medium"
            >
              Clear Chat
            </button>
          </div>
        </div>
      </div>

      {/* Right - Chat Interface */}
      <div className="flex-1 flex flex-col h-[calc(100vh-64px)] lg:h-screen">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4 max-w-md">
                <div className="text-6xl">🧪</div>
                <h2 className="text-2xl font-bold text-purple-300">LLM Lab</h2>
                <p className="text-purple-400">
                  Test different model configurations in this sandbox environment.
                  Messages here don't affect production.
                </p>
                <div className="text-sm text-purple-500">
                  Select a preset or configure your own model settings to get started.
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`
                    max-w-[80%] rounded-2xl px-4 py-3
                    ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-purple-600 to-purple-700 text-white'
                        : msg.role === 'system'
                        ? 'bg-red-900/40 border border-red-500/30 text-red-300'
                        : 'bg-gradient-to-br from-cyan-900/40 to-purple-900/40 border border-cyan-500/20 text-cyan-50'
                    }
                  `}
                >
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  
                  {/* Metadata footer for assistant messages */}
                  {msg.role === 'assistant' && msg.metadata && (
                    <div className="mt-3 pt-3 border-t border-cyan-500/20 text-xs text-cyan-400/70 space-y-1">
                      {msg.metadata.model && (
                        <div>Model: {msg.metadata.model.split('/').pop()}</div>
                      )}
                      <div className="flex gap-4">
                        {msg.metadata.latency && <span>⏱️ {msg.metadata.latency}ms</span>}
                        {msg.metadata.tokens && <span>🔢 {msg.metadata.tokens} tokens</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isStreaming && (
            <div className="flex justify-start">
              <div className="bg-gradient-to-br from-cyan-900/40 to-purple-900/40 border border-cyan-500/20 rounded-2xl px-4 py-3">
                <div className="flex gap-2">
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" />
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                  <div className="w-2 h-2 bg-cyan-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="border-t border-purple-500/20 bg-gradient-to-r from-purple-900/20 to-cyan-900/20 backdrop-blur-sm p-4">
          <div className="flex gap-3 max-w-4xl mx-auto">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message... (Enter to send, Shift+Enter for new line)"
              className="flex-1 px-4 py-3 bg-purple-900/30 border border-purple-500/30 rounded-xl text-white placeholder-purple-400/50 focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none min-h-[60px] max-h-[200px]"
              disabled={isStreaming}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="px-6 py-3 bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-700 hover:to-cyan-700 disabled:from-gray-600 disabled:to-gray-700 disabled:cursor-not-allowed rounded-xl font-semibold transition-all shadow-lg hover:shadow-purple-500/50"
            >
              {isStreaming ? '⏳' : '📤'} Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
