/**
 * RiveAvatarLipsync Usage Examples
 * 
 * This file demonstrates various ways to integrate and use the RiveAvatarLipsync feature
 * in different scenarios and configurations.
 */

import { useEffect, useState } from 'react';

// Import client components and hooks directly to avoid server/client mixing
import {
  lipsyncService,
  type LipsyncConfig,
  type LlmMessage
} from '@interface/features/RiveAvatarLipsync';

import { LipsyncDebugPanel } from '../components/LipsyncDebugPanel';
import { RiveAvatarLipsync } from '../components/RiveAvatarLipsync';
import { useAnimationControl } from '../lib/useAnimationControl';

// Import server-side resources from barrel

// Example 1: Basic Avatar with Lipsync
export function BasicAvatarExample() {

  return (
    <div className="flex flex-col items-center space-y-4">
      <h2 className="text-xl font-bold">Basic Avatar with Lipsync</h2>
      <RiveAvatarLipsync 
        width={300}
        height={300}
        className="border rounded-lg shadow-lg"
      />
    </div>
  );
}

// Example 2: Avatar with Debug Panel (Development)
export function AvatarWithDebugExample() {
  return (
    <div className="flex gap-6">
      <div>
        <h3 className="text-lg font-semibold mb-4">Avatar</h3>
        <RiveAvatarLipsync 
          width={250}
          height={250}
          enableDebug={true}
        />
      </div>
      
      <div className="flex-1">
        <h3 className="text-lg font-semibold mb-4">Debug Panel</h3>
        <LipsyncDebugPanel />
      </div>
    </div>
  );
}

// Example 3: Custom Animation Control
export function CustomAnimationControlExample() {
  const { 
    animationState, 
    speechState, 
    forceStopAnimations, 
    resumeAnimations 
  } = useAnimationControl();

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Custom Animation Control</h3>
      
      <RiveAvatarLipsync width={200} height={200} />
      
      {/* Control Panel */}
      <div className="bg-gray-100 p-4 rounded">
        <h4 className="font-medium mb-2">Manual Controls</h4>
        <div className="flex gap-2 mb-4">
          <button
            onClick={forceStopAnimations}
            className="px-3 py-1 bg-red-500 text-white rounded text-sm"
          >
            Force Stop
          </button>
          <button
            onClick={resumeAnimations}
            className="px-3 py-1 bg-green-500 text-white rounded text-sm"
          >
            Resume
          </button>
        </div>
        
        {/* State Display */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="font-medium">Animation State</div>
            <div>Type: {animationState.animationType}</div>
            <div>Intensity: {(animationState.intensity * 100).toFixed(1)}%</div>
            <div>Should Animate: {animationState.shouldShowTalkingAnimation ? '✅' : '❌'}</div>
          </div>
          <div>
            <div className="font-medium">Speech State</div>
            <div>User Speaking: {speechState.isUserSpeaking ? '🎤' : '🔇'}</div>
            <div>Assistant Speaking: {speechState.isAssistantSpeaking ? '🗣️' : '😐'}</div>
            <div>Confidence: {(speechState.assistantSpeechConfidence * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Example 4: Service Configuration
export function ServiceConfigurationExample() {
  const [config, setConfig] = useState<Partial<LipsyncConfig>>({});
  const [serviceStatus, setServiceStatus] = useState('stopped');

  useEffect(() => {
    // Initialize with custom configuration
    const initializeService = async () => {
      const customConfig: Partial<LipsyncConfig> = {
        enabled: true,
        useRiveAnimations: true,
        voiceConfusion: {
          transcriptOnlyTriggers: true,
          userSpeechResponseTime: 25, // Ultra-fast response
          speechEndTimeout: 1200
        },
        confidenceWeights: {
          contentLength: 0.5,    // Emphasize content
          transcriptFinality: 0.3,
          substantialContent: 0.1,
          recentActivity: 0.1
        },
        debug: {
          enableLogging: true,
          showDebugPanel: false,
          logStateChanges: true
        }
      };

      await lipsyncService.initialize(customConfig);
      lipsyncService.start();
      setConfig(customConfig);
      setServiceStatus('running');
    };

    initializeService();

    return () => {
      lipsyncService.stop();
      setServiceStatus('stopped');
    };
  }, []);

  const handleConfigUpdate = (updates: Partial<LipsyncConfig>) => {
    lipsyncService.updateConfig(updates);
    setConfig(prev => ({ ...prev, ...updates }));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Service Configuration</h3>
      
      <div className="flex gap-6">
        <div className="flex-1">
          <RiveAvatarLipsync width={200} height={200} />
        </div>
        
        <div className="flex-1 space-y-4">
          <div>
            <div className="font-medium">Service Status: 
              <span className={`ml-2 px-2 py-1 rounded text-sm ${
                serviceStatus === 'running' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
              }`}>
                {serviceStatus}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => handleConfigUpdate({ enabled: e.target.checked })}
              />
              <span>Enable Lipsync</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.useRiveAnimations}
                onChange={(e) => handleConfigUpdate({ useRiveAnimations: e.target.checked })}
              />
              <span>Use Rive Animations</span>
            </label>
            
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={config.voiceConfusion?.transcriptOnlyTriggers}
                onChange={(e) => handleConfigUpdate({ 
                  voiceConfusion: { 
                    transcriptOnlyTriggers: e.target.checked,
                    userSpeechResponseTime: config.voiceConfusion?.userSpeechResponseTime || 50,
                    speechEndTimeout: config.voiceConfusion?.speechEndTimeout || 1500
                  }
                })}
              />
              <span>Transcript-Only Triggers</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              User Speech Response Time: {config.voiceConfusion?.userSpeechResponseTime || 50}ms
            </label>
            <input
              type="range"
              min="10"
              max="200"
              value={config.voiceConfusion?.userSpeechResponseTime || 50}
              onChange={(e) => handleConfigUpdate({
                voiceConfusion: {
                  transcriptOnlyTriggers: config.voiceConfusion?.transcriptOnlyTriggers || true,
                  userSpeechResponseTime: Number(e.target.value),
                  speechEndTimeout: config.voiceConfusion?.speechEndTimeout || 1500
                }
              })}
              className="w-full"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Example 5: LLM Message Simulation
export function LlmMessageSimulationExample() {
  const [messages, setMessages] = useState<LlmMessage[]>([]);

  const simulateMessage = (message: LlmMessage) => {
    lipsyncService.processLlmMessage(message);
    setMessages(prev => [...prev, message].slice(-5)); // Keep last 5
  };

  const simulateAssistantTranscript = () => {
    simulateMessage({
      type: 'transcript',
      role: 'assistant',
      transcript: 'Hello! This is a simulated assistant message with substantial content to test the lipsync animation system.',
      transcriptType: 'final'
    });
  };

  const simulatePartialTranscript = () => {
    simulateMessage({
      type: 'transcript',
      role: 'assistant',
      transcript: 'This is a partial...',
      transcriptType: 'partial'
    });
  };

  const simulateConversationEnd = () => {
    simulateMessage({
      type: 'conversation-update',
      role: 'assistant',
      transcriptType: 'final'
    });
  };

  const simulateSpeechUpdate = () => {
    simulateMessage({
      type: 'speech-update',
      status: 'started'
    });
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">LLM Message Simulation</h3>
      
      <div className="flex gap-6">
        <div>
          <RiveAvatarLipsync width={200} height={200} enableDebug={true} />
        </div>
        
        <div className="flex-1 space-y-4">
          <div>
            <h4 className="font-medium mb-2">Simulate Messages</h4>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={simulateAssistantTranscript}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
              >
                Assistant Transcript
              </button>
              <button
                onClick={simulatePartialTranscript}
                className="px-3 py-1 bg-yellow-500 text-white rounded text-sm"
              >
                Partial Transcript
              </button>
              <button
                onClick={simulateConversationEnd}
                className="px-3 py-1 bg-green-500 text-white rounded text-sm"
              >
                Conversation End
              </button>
              <button
                onClick={simulateSpeechUpdate}
                className="px-3 py-1 bg-gray-500 text-white rounded text-sm"
              >
                Speech Update
              </button>
            </div>
          </div>

          <div>
            <h4 className="font-medium mb-2">Recent Messages</h4>
            <div className="bg-gray-50 p-3 rounded max-h-40 overflow-y-auto">
              {messages.length === 0 ? (
                <div className="text-gray-500 text-sm">No messages yet</div>
              ) : (
                messages.map((msg, idx) => (
                  <div key={idx} className="text-xs mb-2 p-2 bg-white rounded">
                    <div className="font-medium">{msg.type}</div>
                    {msg.role && <div>Role: {msg.role}</div>}
                    {msg.transcript && <div>Transcript: {msg.transcript.substring(0, 50)}...</div>}
                    {msg.transcriptType && <div>Type: {msg.transcriptType}</div>}
                    {msg.status && <div>Status: {msg.status}</div>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Example 6: Performance Monitoring
export function PerformanceMonitoringExample() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [metrics, setMetrics] = useState<any>(null);

  useEffect(() => {
    const interval = setInterval(async () => {
      const currentMetrics = lipsyncService.getMetrics();
      setMetrics(currentMetrics);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Performance Monitoring</h3>
      
      <div className="flex gap-6">
        <div>
          <RiveAvatarLipsync width={200} height={200} />
        </div>
        
        {metrics && (
          <div className="flex-1">
            <h4 className="font-medium mb-2">Real-time Metrics</h4>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <div>Messages Processed: <span className="font-mono">{metrics.messagesProcessed}</span></div>
                <div>Animation Changes: <span className="font-mono">{metrics.animationStateChanges}</span></div>
                <div>RULE 6 Violations: <span className={`font-mono ${metrics.rule6Violations > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {metrics.rule6Violations}
                </span></div>
              </div>
              <div className="space-y-1">
                <div>Is Running: <span className={`font-mono ${metrics.isRunning ? 'text-green-600' : 'text-red-600'}`}>
                  {metrics.isRunning ? 'Yes' : 'No'}
                </span></div>
                <div>Average Confidence: <span className="font-mono">{(metrics.averageConfidence * 100).toFixed(1)}%</span></div>
                <div>Last Processing: <span className="font-mono">{metrics.lastProcessingTime}ms</span></div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Main Example Container
export function RiveAvatarLipsyncExamples() {
  const [activeExample, setActiveExample] = useState('basic');

  const examples = [
    { key: 'basic', label: 'Basic Avatar', component: BasicAvatarExample },
    { key: 'debug', label: 'With Debug Panel', component: AvatarWithDebugExample },
    { key: 'control', label: 'Custom Control', component: CustomAnimationControlExample },
    { key: 'config', label: 'Service Config', component: ServiceConfigurationExample },
    { key: 'llm', label: 'LLM Simulation', component: LlmMessageSimulationExample },
    { key: 'metrics', label: 'Performance', component: PerformanceMonitoringExample },
  ];

  const ActiveComponent = examples.find(ex => ex.key === activeExample)?.component || BasicAvatarExample;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">RiveAvatarLipsync Examples</h1>
      
      {/* Example Selector */}
      <div className="flex flex-wrap gap-2 mb-8">
        {examples.map(example => (
          <button
            key={example.key}
            onClick={() => setActiveExample(example.key)}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              activeExample === example.key
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {example.label}
          </button>
        ))}
      </div>
      
      {/* Active Example */}
      <div className="border rounded-lg p-6 bg-white">
        <ActiveComponent />
      </div>
    </div>
  );
}
