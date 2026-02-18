/**
 * LipsyncDebugPanel - Development debugging component
 * 
 * Provides real-time monitoring and debugging capabilities for the lipsync system:
 * - Animation state visualization
 * - Speech detection monitoring
 * - Confidence scoring display
 * - RULE 6 violation detection
 * - Performance metrics
 */

"use client";

import React, { useState, useEffect } from 'react';
import { useAnimationControl } from '../lib/useAnimationControl';
import { getClientLogger } from '@interface/lib/client-logger';

interface LipsyncDebugPanelProps {
  className?: string;
  compact?: boolean;
}

export const LipsyncDebugPanel: React.FC<LipsyncDebugPanelProps> = ({ 
  className = '',
  compact = false
}) => {
  const { animationState, speechState } = useAnimationControl();
  const log = getClientLogger('RiveAvatarLipsync');
  const [isExpanded, setIsExpanded] = useState(!compact);
  const [violationCount, setViolationCount] = useState(0);
  const [lastViolation, setLastViolation] = useState<string | null>(null);

  // Monitor for RULE 6 violations
  useEffect(() => {
    if (speechState.isUserSpeaking && animationState.shouldShowTalkingAnimation) {
      setViolationCount(prev => prev + 1);
      setLastViolation(new Date().toLocaleTimeString());
      log.warn('Rule 6 violation detected: user speaking but animation active');
    }
  }, [speechState.isUserSpeaking, animationState.shouldShowTalkingAnimation]);

  const getAnimationStatusColor = () => {
    if (animationState.forceStopAnimation) return 'text-red-400';
    if (animationState.shouldShowTalkingAnimation) return 'text-green-400';
    return 'text-yellow-400';
  };

  const getSpeechStatusColor = () => {
    if (speechState.isUserSpeaking) return 'text-red-400';
    if (speechState.isAssistantSpeaking) return 'text-green-400';
    return 'text-gray-400';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence > 0.7) return 'text-green-400';
    if (confidence > 0.4) return 'text-yellow-400';
    return 'text-red-400';
  };

  if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'development') {
    return null; // Only show in development
  }

  return (
    <div className={`lipsync-debug-panel ${className}`}>
      <div className="bg-black/90 text-white border border-gray-600 rounded-lg shadow-lg">
        {/* Header */}
        <div 
          className="flex items-center justify-between p-3 cursor-pointer border-b border-gray-600"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center space-x-2">
            <span className="text-lg">🎭</span>
            <span className="font-bold text-sm">Lipsync Debug</span>
            {violationCount > 0 && (
              <span className="bg-red-500 text-white px-2 py-1 text-xs rounded">
                {violationCount} violations
              </span>
            )}
          </div>
          <span className="text-gray-400 text-sm">
            {isExpanded ? '▼' : '▶'}
          </span>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="p-3 space-y-3">
            {/* Animation Status */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <h4 className="text-blue-400 font-semibold text-sm mb-2">Animation State</h4>
                <div className="space-y-1 text-xs">
                  <div className={`flex justify-between ${getAnimationStatusColor()}`}>
                    <span>Status:</span>
                    <span>{animationState.animationType.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Show Talking:</span>
                    <span>{animationState.shouldShowTalkingAnimation ? '✅' : '❌'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Force Stop:</span>
                    <span>{animationState.forceStopAnimation ? '🚫' : '➡️'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>User Dominant:</span>
                    <span>{animationState.isUserDominant ? '👤' : '🤖'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Intensity:</span>
                    <span className={getConfidenceColor(animationState.intensity)}>
                      {(animationState.intensity * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Animation:</span>
                    <span className="text-purple-400 truncate max-w-20" title={animationState.animationName}>
                      {animationState.animationName}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-green-400 font-semibold text-sm mb-2">Speech Detection</h4>
                <div className="space-y-1 text-xs">
                  <div className={`flex justify-between ${getSpeechStatusColor()}`}>
                    <span>User Speaking:</span>
                    <span>{speechState.isUserSpeaking ? '🎤' : '🔇'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Assistant Speaking:</span>
                    <span>{speechState.isAssistantSpeaking ? '🗣️' : '😐'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Generating Text:</span>
                    <span>{speechState.isAssistantGeneratingText ? '📝' : '⏸️'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Can Animate:</span>
                    <span>{speechState.canAssistantAnimate ? '✅' : '❌'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Volume Level:</span>
                    <span className={getConfidenceColor(speechState.assistantVolumeLevel / 100)}>
                      {speechState.assistantVolumeLevel}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Quality:</span>
                    <span className={speechState.transcriptQuality === 'final' ? 'text-green-400' : 'text-yellow-400'}>
                      {speechState.transcriptQuality}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Confidence and Transcript */}
            <div>
              <h4 className="text-yellow-400 font-semibold text-sm mb-2">Intelligence Layer</h4>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span>Speech Confidence:</span>
                  <span className={getConfidenceColor(speechState.assistantSpeechConfidence)}>
                    {(speechState.assistantSpeechConfidence * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Message Length:</span>
                  <span>{speechState.lastAssistantMessage.length} chars</span>
                </div>
                <div className="flex justify-between">
                  <span>Recent Activity:</span>
                  <span className={Date.now() - speechState.speechTimestamp < 10000 ? 'text-green-400' : 'text-red-400'}>
                    {speechState.speechTimestamp > 0 ? `${Math.round((Date.now() - speechState.speechTimestamp) / 1000)}s ago` : 'None'}
                  </span>
                </div>
              </div>
            </div>

            {/* Last Message Preview */}
            {speechState.lastAssistantMessage && (
              <div>
                <h4 className="text-purple-400 font-semibold text-sm mb-2">Last Message</h4>
                <div className="bg-gray-800 p-2 rounded text-xs text-gray-300 max-h-16 overflow-y-auto">
                  {speechState.lastAssistantMessage.substring(0, 150)}
                  {speechState.lastAssistantMessage.length > 150 && '...'}
                </div>
              </div>
            )}

            {/* RULE 6 Violations */}
            {violationCount > 0 && (
              <div className="border-t border-red-600 pt-2">
                <h4 className="text-red-400 font-semibold text-sm mb-2">🚨 RULE 6 Violations</h4>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span>Total Count:</span>
                    <span className="text-red-400 font-bold">{violationCount}</span>
                  </div>
                  {lastViolation && (
                    <div className="flex justify-between">
                      <span>Last Violation:</span>
                      <span className="text-red-400">{lastViolation}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="border-t border-gray-600 pt-2">
              <div className="flex space-x-2">
                <button
                  onClick={() => setViolationCount(0)}
                  className="px-2 py-1 bg-gray-700 hover:bg-gray-600 text-xs rounded"
                >
                  Reset Violations
                </button>
                <button
                  onClick={() => log.debug('Current state', { animationState, speechState })}
                  className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-xs rounded"
                >
                  Log State
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
