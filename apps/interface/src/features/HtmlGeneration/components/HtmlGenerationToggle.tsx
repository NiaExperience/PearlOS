'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@interface/components/ui/dialog';
import { Button } from '@interface/components/ui/button';
import { Slider } from '@interface/components/ui/slider';
import { Zap, Brain, Sparkles, Clock } from 'lucide-react';

interface HtmlGenerationToggleProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (useOpenAI: boolean) => void;
  title: string;
  description: string;
}

const GOHUFONT_FONT_FACE = `
@font-face {
  font-family: 'Gohufont';
  src: url('/fonts/Gohu/GohuFontuni14NerdFontMono-Regular.ttf') format('truetype');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}
`;

const ensureGohufont = () => {
  if (typeof document === 'undefined') return;
  if (document.getElementById('gohufont-font-face')) return;
  const style = document.createElement('style');
  style.id = 'gohufont-font-face';
  style.textContent = GOHUFONT_FONT_FACE;
  document.head.appendChild(style);
};

export default function HtmlGenerationToggle({
  isOpen,
  onClose,
  onConfirm,
  title,
  description
}: HtmlGenerationToggleProps) {
  const [selectedMode, setSelectedMode] = useState<'fast' | 'advanced'>('fast');
  const [sliderValue, setSliderValue] = useState([0]); // 0 = Fast, 1 = Advanced

  useEffect(() => {
    ensureGohufont();
  }, []);

  // Update selected mode when slider changes
  useEffect(() => {
    setSelectedMode(sliderValue[0] === 0 ? 'fast' : 'advanced');
  }, [sliderValue]);

  const handleConfirm = () => {
    onConfirm(selectedMode === 'fast');
    onClose();
  };

  const handleModeSelect = (mode: 'fast' | 'advanced') => {
    setSelectedMode(mode);
    setSliderValue(mode === 'fast' ? [0] : [1]);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md" style={{ fontFamily: 'Gohufont, monospace' }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-blue-500" />
            Choose AI Engine
          </DialogTitle>
          <DialogDescription>
            Select the AI engine for generating your "{title}" content
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Slider Control */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Generation Speed</span>
              <span className="text-sm text-muted-foreground">
                {selectedMode === 'fast' ? 'Fast' : 'More Advanced'}
              </span>
            </div>
            
            <div className="px-2">
              <Slider
                value={sliderValue}
                onValueChange={setSliderValue}
                max={1}
                step={1}
                className="w-full"
              />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Fast</span>
              <span>More Advanced</span>
            </div>
          </div>

          {/* Mode Cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Fast Mode Card */}
            <div
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                selectedMode === 'fast'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              }`}
              onClick={() => handleModeSelect('fast')}
            >
              <div className="flex items-center gap-2 mb-2">
                <Zap className={`h-4 w-4 ${selectedMode === 'fast' ? 'text-blue-500' : 'text-gray-500'}`} />
                <span className="font-medium text-sm">Fast</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Quick generation with OpenAI GPT-4o
              </p>
              <div className="flex items-center gap-1 mt-2">
                <Clock className="h-3 w-3 text-green-500" />
                <span className="text-xs text-green-600 dark:text-green-400">~15-30s</span>
              </div>
            </div>

            {/* Advanced Mode Card */}
            <div
              className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                selectedMode === 'advanced'
                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
              }`}
              onClick={() => handleModeSelect('advanced')}
            >
              <div className="flex items-center gap-2 mb-2">
                <Brain className={`h-4 w-4 ${selectedMode === 'advanced' ? 'text-purple-500' : 'text-gray-500'}`} />
                <span className="font-medium text-sm">Advanced</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Enhanced quality with Claude Opus 4.1
              </p>
              <div className="flex items-center gap-1 mt-2">
                <Clock className="h-3 w-3 text-orange-500" />
                <span className="text-xs text-orange-600 dark:text-orange-400">~30-60s</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="text-xs text-muted-foreground bg-muted p-3 rounded-md">
            <p className="mb-2">
              <strong>Fast Mode:</strong> Uses OpenAI GPT-4o for quicker generation with good quality.
            </p>
            <p>
              <strong>Advanced Mode:</strong> Uses Anthropic Claude Opus 4.1 for enhanced creativity and more sophisticated output.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-4">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button onClick={handleConfirm} className="flex-1">
            Generate with {selectedMode === 'fast' ? 'Fast' : 'Advanced'} Engine
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
