'use client';

import { PersonalityVoiceConfig } from '@nia/prism/core/blocks/assistant.block';
import { useState, useEffect } from 'react';

import { Button } from '@interface/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@interface/components/ui/dialog';

interface PersonalitySelectorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowedPersonalities: Record<string, PersonalityVoiceConfig>;
  currentPersonalityKey?: string; // Changed from currentPersonalityId - now uses composite key
  onSelectPersonality: (config: PersonalityVoiceConfig) => void;
}

export function PersonalitySelector({
  open,
  onOpenChange,
  allowedPersonalities,
  currentPersonalityKey,
  onSelectPersonality,
}: PersonalitySelectorProps) {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(currentPersonalityKey);

  // Update selected key when current personality changes
  useEffect(() => {
    setSelectedKey(currentPersonalityKey);
  }, [currentPersonalityKey]);

  const handleSelect = (key: string) => {
    const config = allowedPersonalities[key];
    if (config) {
      setSelectedKey(key);
      onSelectPersonality(config);
      onOpenChange(false);
    }
  };

  const personalityEntries = Object.entries(allowedPersonalities);

  if (personalityEntries.length === 0) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Select Personality</DialogTitle>
            <DialogDescription>
              No personalities are currently available for this assistant.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 text-center text-muted-foreground">
            Contact your administrator to add personalities.
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[92vw] max-w-md space-y-5 border-white/10 bg-[#161f2e] text-white sm:w-auto sm:max-w-2xl"
        style={{ fontFamily: 'Gohufont, monospace' }}
      >
        <DialogHeader>
          <DialogTitle className="text-white">Select Personality</DialogTitle>
          <DialogDescription className="text-white/70">
            Choose a personality for your assistant. Each personality has a unique voice and style.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[55vh] gap-3 overflow-y-auto py-4 pr-1 sm:max-h-[60vh]">
          {personalityEntries.map(([key, config]) => {
            const isSelected = selectedKey === key; // Compare using the composite key
            const voiceLabel = config.voice.provider === '11labs' 
              ? 'ElevenLabs' 
              : config.voice.provider === 'kokoro' 
              ? 'Kokoro' 
              : config.voice.provider;

            return (
              <button
                key={key}
                onClick={() => handleSelect(key)} // Pass the composite key directly
                className={`
                  relative flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left
                  text-white transition-all
                  ${isSelected 
                    ? 'border-white bg-white/10' 
                    : 'border-white/20 hover:border-white/40'
                  }
                `}
              >
                <div className="flex w-full items-start justify-between">
                  <div className="flex-1">
                    <h4 className="font-semibold text-white">{config.personalityName}</h4>
                    {/* <div className="mt-1 flex items-center gap-2 text-sm text-white/70">
                      <span>Voice: {voiceLabel}</span>
                    </div> */}
                  </div>
                  {isSelected && (
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[#161f2e]">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="h-4 w-4"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Voice parameters preview */}
                {config.voice && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-white/70">
                    {config.voice.stability !== undefined && (
                      <span>Stability: {config.voice.stability.toFixed(2)}</span>
                    )}
                    {config.voice.similarityBoost !== undefined && (
                      <span>Similarity: {config.voice.similarityBoost.toFixed(2)}</span>
                    )}
                    {config.voice.speed !== undefined && (
                      <span>Speed: {config.voice.speed.toFixed(2)}</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white"
            onClick={() => onOpenChange(false)}
            style={{ fontFamily: 'Gohufont, monospace' }}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
