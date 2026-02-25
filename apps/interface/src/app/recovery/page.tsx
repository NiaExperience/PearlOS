'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';

interface ServiceStatus {
  name: string;
  status: 'checking' | 'ok' | 'error';
  detail?: string;
}

function RecoveryContent() {
  const searchParams = useSearchParams();
  const error = searchParams.get('error') || '';
  const assistantName = searchParams.get('assistant') || 'pearlos';

  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [reseedStatus, setReseedStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const checkServices = useCallback(async () => {
    setServices([
      { name: 'Next.js Interface', status: 'checking' },
      { name: 'OpenClaw Gateway', status: 'checking' },
      { name: 'Mesh GraphQL', status: 'checking' },
      { name: 'Bot Gateway (Pipecat)', status: 'checking' },
      { name: 'PocketTTS (Azelma)', status: 'checking' },
    ]);
    try {
      const res = await fetch('/api/recovery/status');
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      setServices((prev) => prev.map((s) => ({ ...s, status: 'error' as const, detail: 'Status API unreachable' })));
    }
  }, []);

  useEffect(() => {
    checkServices();
  }, [checkServices]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  const handleReseed = async () => {
    setReseedStatus('running');
    try {
      const res = await fetch('/api/recovery/reseed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantName }),
      });
      setReseedStatus(res.ok ? 'success' : 'error');
    } catch {
      setReseedStatus('error');
    }
  };

  const handleChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const newMessages = [...chatMessages, { role: 'user', content: userMsg }];
    setChatMessages(newMessages);
    setChatLoading(true);
    try {
      const res = await fetch('/api/recovery/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: newMessages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content || data?.error || 'No response received.';
      setChatMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `Error: Could not reach gateway. ${err}` }]);
    }
    setChatLoading(false);
  };

  const statusIcon = (s: string) => (s === 'ok' ? '🟢' : s === 'error' ? '🔴' : '🟡');
  const allOk = services.length > 0 && services.every((s) => s.status === 'ok');
  const anyError = services.some((s) => s.status === 'error');

  return (
    <div
      role="main"
      aria-label="PearlOS Recovery Page"
      style={{ background: '#05030f', minHeight: '100vh', color: '#e0e0e0', fontFamily: 'system-ui, sans-serif' }}
    >
      <div
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(circle at 30% -10%, rgba(243, 104, 224, 0.2), transparent), radial-gradient(circle at 70% 110%, rgba(0, 210, 211, 0.15), transparent), #05030f',
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 700, margin: '0 auto', padding: '40px 20px' }}>
        {/* Header */}
        <header>
          <h1
            style={{
              fontSize: 32,
              fontWeight: 'bold',
              marginBottom: 8,
              background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            🔧 PearlOS Recovery
          </h1>
          <p style={{ color: '#888', marginBottom: 8 }}>
            {error === 'assistant_not_found'
              ? `The assistant "${assistantName}" couldn't be found or created. Let's fix that.`
              : "Something went wrong. Let's get you back up and running."}
          </p>
          {allOk && (
            <p style={{ color: '#10b981', fontSize: 14, marginBottom: 24 }}>
              ✅ All services are healthy. Try loading PearlOS again.
            </p>
          )}
          {anyError && (
            <p style={{ color: '#ef4444', fontSize: 14, marginBottom: 24 }}>
              ⚠️ Some services are down. Check status below or use Direct Chat as a fallback.
            </p>
          )}
        </header>

        {/* Service Status */}
        <section
          aria-label="Service Status"
          style={{
            background: 'rgba(15,15,35,0.9)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Service Status</h2>
          <div role="list">
            {services.map((svc) => (
              <div
                key={svc.name}
                role="listitem"
                aria-label={`${svc.name}: ${svc.status}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.05)',
                }}
              >
                <span>{svc.name}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {statusIcon(svc.status)} {svc.status}
                  {svc.detail && svc.status === 'error' && (
                    <span style={{ color: '#666', fontSize: 12 }}>({svc.detail})</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={checkServices}
            aria-label="Recheck all services"
            style={{
              marginTop: 12,
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              padding: '8px 16px',
              color: '#e0e0e0',
              cursor: 'pointer',
            }}
          >
            🔄 Recheck
          </button>
        </section>

        {/* Quick Fixes */}
        <section
          aria-label="Quick Fixes"
          style={{
            background: 'rgba(15,15,35,0.9)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>Quick Fixes</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={handleReseed}
              disabled={reseedStatus === 'running'}
              aria-label="Reseed assistant database"
              style={{
                background:
                  reseedStatus === 'success'
                    ? 'linear-gradient(135deg, #10b981, #059669)'
                    : 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                border: 'none',
                borderRadius: 12,
                padding: '14px 24px',
                color: 'white',
                fontSize: 16,
                fontWeight: 600,
                cursor: reseedStatus === 'running' ? 'wait' : 'pointer',
                opacity: reseedStatus === 'running' ? 0.7 : 1,
              }}
            >
              {reseedStatus === 'idle' && '🌱 Reseed Assistant Database'}
              {reseedStatus === 'running' && '⏳ Reseeding...'}
              {reseedStatus === 'success' && '✅ Reseeded! Try loading again.'}
              {reseedStatus === 'error' && '❌ Reseed failed - try again'}
            </button>

            <a
              href={`/${assistantName}`}
              aria-label="Try loading PearlOS again"
              style={{
                display: 'block',
                textAlign: 'center',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 12,
                padding: '14px 24px',
                color: '#e0e0e0',
                fontSize: 16,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              🏠 Try Loading PearlOS Again
            </a>

            <a
              href="/settings"
              aria-label="Open settings page"
              style={{
                display: 'block',
                textAlign: 'center',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 12,
                padding: '14px 24px',
                color: '#e0e0e0',
                fontSize: 16,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              ⚙️ Open Settings (always works)
            </a>
          </div>
        </section>

        {/* Direct Chat Fallback */}
        <section
          aria-label="Direct Chat with OpenClaw Gateway"
          style={{
            background: 'rgba(15,15,35,0.9)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>💬 Direct Chat (OpenClaw Gateway)</h2>
          <p style={{ color: '#888', fontSize: 14, marginBottom: 16 }}>
            Bypass PearlOS entirely — talk directly to the AI via the gateway.
          </p>

          <div
            role="log"
            aria-label="Chat messages"
            aria-live="polite"
            style={{
              maxHeight: 300,
              overflowY: 'auto',
              marginBottom: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {chatMessages.length === 0 && (
              <p style={{ color: '#555', fontStyle: 'italic' }}>Send a message to start chatting...</p>
            )}
            {chatMessages.map((msg, i) => (
              <div
                key={i}
                aria-label={`${msg.role === 'user' ? 'You' : 'Pearl'}: ${msg.content}`}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  maxWidth: '85%',
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  background:
                    msg.role === 'user'
                      ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
                      : 'rgba(255,255,255,0.08)',
                  whiteSpace: 'pre-wrap',
                  fontSize: 14,
                }}
              >
                {msg.content}
              </div>
            ))}
            {chatLoading && (
              <div style={{ color: '#888', fontStyle: 'italic' }} aria-label="Pearl is thinking">
                Thinking...
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <label htmlFor="recovery-chat-input" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>
              Chat message
            </label>
            <input
              id="recovery-chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
              placeholder="Type a message..."
              aria-label="Type a message to Pearl"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 10,
                padding: '12px 16px',
                color: '#e0e0e0',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button
              onClick={handleChat}
              disabled={chatLoading}
              aria-label="Send message"
              style={{
                background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
                border: 'none',
                borderRadius: 10,
                padding: '12px 20px',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        </section>

        {/* Keyboard shortcut hint */}
        <p style={{ color: '#444', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
          Tip: Access this page anytime at <code style={{ color: '#666' }}>/recovery</code> or from Settings → Recovery
        </p>
      </div>
    </div>
  );
}

export default function RecoveryPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            background: '#05030f',
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
          }}
        >
          Loading recovery...
        </div>
      }
    >
      <RecoveryContent />
    </Suspense>
  );
}
