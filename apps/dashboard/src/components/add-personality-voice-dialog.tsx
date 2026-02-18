'use client';

import { PersonalityVoiceConfig, VoiceProviderType, IVoice } from '@nia/prism/core/blocks/assistant.block';
import { KOKORO_VOICES } from '@nia/prism/core/constants/kokoro-voices';
import { Play, Square, Loader2 } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';

import { Button } from '@dashboard/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@dashboard/components/ui/dialog';
import { Input } from '@dashboard/components/ui/input';
import { Label } from '@dashboard/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dashboard/components/ui/select';
import { Slider } from '@dashboard/components/ui/slider';
import { useToast } from '@dashboard/hooks/use-toast';

interface AddPersonalityVoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  onSave: (config: PersonalityVoiceConfig) => void;
  existingConfig?: PersonalityVoiceConfig;
}

type PersonalityItem = { _id: string; key: string; name?: string };

function formatRegion(language: string): string {
  switch (language) {
    case 'en-US':
      return 'American';
    case 'en-GB':
      return 'British';
    case 'fr-FR':
      return 'French';
    case 'it-IT':
      return 'Italian';
    case 'ja-JP':
      return 'Japanese';
    case 'zh-CN':
      return 'Mandarin';
    default:
      return language;
  }
}

function formatVoiceName(voiceId: string): string {
  const parts = voiceId.split('_');
  const name = parts[parts.length - 1] ?? voiceId;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function AddPersonalityVoiceDialog({
  open,
  onOpenChange,
  tenantId,
  onSave,
  existingConfig,
}: AddPersonalityVoiceDialogProps) {
  const [personalities, setPersonalities] = useState<PersonalityItem[]>([]);
  const [loadingPersonalities, setLoadingPersonalities] = useState(false);
  
  // Form state
  const [selectedPersonalityId, setSelectedPersonalityId] = useState(existingConfig?.personalityId || '');
  const [selectedPersonalityName, setSelectedPersonalityName] = useState(existingConfig?.personalityName || '');
  const [personaName, setPersonaName] = useState(existingConfig?.personaName || '');
  
  const [voiceProvider, setVoiceProvider] = useState<VoiceProviderType>(
    existingConfig?.voice?.provider || VoiceProviderType.ELEVEN_LABS
  );
  const [voiceId, setVoiceId] = useState(existingConfig?.voice?.voiceId || '');
  
  // Voice Parameters
  const [stability, setStability] = useState(existingConfig?.voice?.stability ?? 0.5);
  const [similarityBoost, setSimilarityBoost] = useState(existingConfig?.voice?.similarityBoost ?? 0.5);
  const [style, setStyle] = useState(existingConfig?.voice?.style ?? 0);
  const [speed, setSpeed] = useState(existingConfig?.voice?.speed ?? 1);
  const [optimizeStreamingLatency, setOptimizeStreamingLatency] = useState(existingConfig?.voice?.optimizeStreamingLatency ?? 0);

  // Voice Preview state
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const { toast } = useToast();

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // Voice Preview handler
  const handleVoicePreview = useCallback(async () => {
    if (!voiceId) {
      toast({
        title: 'Voice Required',
        description: 'Please select a voice before previewing.',
        variant: 'destructive',
      });
      return;
    }

    // Stop existing playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }

    setIsPreviewLoading(true);
    setIsPreviewPlaying(false);

    try {
      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: voiceProvider,
          voiceId,
          personaName: personaName || selectedPersonalityName || 'your assistant',
          stability,
          similarityBoost,
          style,
          speed,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Preview failed: ${response.status}`);
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);

      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      // Track whether playback started successfully to avoid spurious error toasts
      let playbackStarted = false;

      audio.onended = () => {
        setIsPreviewPlaying(false);
        // Clear onerror before revoking URL to prevent spurious error after successful playback
        audio.onerror = null;
        URL.revokeObjectURL(audioUrl);
      };

      audio.onerror = () => {
        // Only show error if playback never started (actual failure vs post-playback cleanup)
        if (!playbackStarted) {
          setIsPreviewPlaying(false);
          URL.revokeObjectURL(audioUrl);
          toast({
            title: 'Playback Error',
            description: 'Failed to play the audio sample.',
            variant: 'destructive',
          });
        }
      };

      setIsPreviewPlaying(true);
      await audio.play();
      playbackStarted = true;
    } catch (error) {
      console.error('[VoicePreview] Error:', error);
      toast({
        title: 'Preview Failed',
        description: error instanceof Error ? error.message : 'Failed to generate voice preview.',
        variant: 'destructive',
      });
    } finally {
      setIsPreviewLoading(false);
    }
  }, [voiceProvider, voiceId, personaName, selectedPersonalityName, stability, similarityBoost, style, speed, toast]);

  // Stop preview playback
  const handleStopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPreviewPlaying(false);
    }
  }, []);

  // Fetch personalities when dialog opens
  useEffect(() => {
    if (!open || !tenantId) return;

    const fetchPersonalities = async () => {
      try {
        setLoadingPersonalities(true);
        const res = await fetch(`/api/personalities?tenantId=${tenantId}`);
        if (!res.ok) {
          setPersonalities([]);
          return;
        }
        const data = await res.json();
        const mapped: PersonalityItem[] = (data.items || []).map((it: Record<string, unknown>) => ({
          _id: it._id || it.page_id,
          key: it.key,
          name: it.name,
        })).sort((a: PersonalityItem, b: PersonalityItem) => 
          (a.name || a.key).localeCompare(b.name || b.key)
        );
        setPersonalities(mapped);
      } catch (e) {
        console.error('Failed to load personalities', e);
        setPersonalities([]);
      } finally {
        setLoadingPersonalities(false);
      }
    };

    fetchPersonalities();
  }, [open, tenantId]);

  // Reset form when dialog closes or existingConfig changes
  useEffect(() => {
    if (existingConfig) {
      setSelectedPersonalityId(existingConfig.personalityId);
      setSelectedPersonalityName(existingConfig.personalityName);
      setPersonaName(existingConfig.personaName);
      
      if (existingConfig.voice) {
        setVoiceProvider(existingConfig.voice.provider);
        setVoiceId(existingConfig.voice.voiceId);
        setStability(existingConfig.voice.stability ?? 0.5);
        setSimilarityBoost(existingConfig.voice.similarityBoost ?? 0.5);
        setStyle(existingConfig.voice.style ?? 0);
        setSpeed(existingConfig.voice.speed ?? 1);
        setOptimizeStreamingLatency(existingConfig.voice.optimizeStreamingLatency ?? 0);
      } else {
        setVoiceProvider(VoiceProviderType.ELEVEN_LABS);
        setVoiceId('');
        setStability(0.5);
        setSimilarityBoost(0.5);
        setStyle(0);
        setSpeed(1);
        setOptimizeStreamingLatency(0);
      }
    } else {
      setSelectedPersonalityId('');
      setSelectedPersonalityName('');
      setPersonaName('');
      setVoiceProvider(VoiceProviderType.ELEVEN_LABS);
      setVoiceId('');
      setStability(0.5);
      setSimilarityBoost(0.5);
      setStyle(0);
      setSpeed(1);
      setOptimizeStreamingLatency(0);
    }
  }, [existingConfig, open]);

  const handlePersonalityChange = (personalityId: string) => {
    setSelectedPersonalityId(personalityId);
    const personality = personalities.find(p => p._id === personalityId);
    if (personality) {
      setSelectedPersonalityName(personality.name || personality.key);
    }
  };

  const handleSave = () => {
    if (!selectedPersonalityId || !voiceId || !selectedPersonalityName) {
      return;
    }

    const config: PersonalityVoiceConfig = {
      personalityId: selectedPersonalityId,
      personalityName: selectedPersonalityName,
      personaName: personaName,
      voice: {
        provider: voiceProvider,
        voiceId: voiceId,
        stability,
        similarityBoost,
        style,
        speed,
        optimizeStreamingLatency,
      } as IVoice,
    };

    onSave(config);
    onOpenChange(false);
  };

  const isValid = Boolean(selectedPersonalityId && voiceId && selectedPersonalityName);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existingConfig ? 'Edit Personality Voice' : 'Add Personality Voice'}
          </DialogTitle>
          <DialogDescription>
            Configure voice settings for a specific personality. This allows users to select
            different personalities with customized voices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Personality Selection */}
          <div className="space-y-2">
            <Label htmlFor="personality">Personality *</Label>
            <Select
              value={selectedPersonalityId}
              onValueChange={handlePersonalityChange}
              disabled={loadingPersonalities}
            >
              <SelectTrigger id="personality">
                <SelectValue placeholder="Select a personality" />
              </SelectTrigger>
              <SelectContent>
                {personalities.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name || p.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Persona Name */}
          <div className="space-y-2">
            <Label htmlFor="persona-name">Persona Name</Label>
            <Input
              id="persona-name"
              value={personaName}
              onChange={(e) => setPersonaName(e.target.value)}
              placeholder="e.g. Nia, Helper"
            />
          </div>

          {/* Voice Provider Selection */}
          <div className="space-y-2">
            <Label htmlFor="voice-provider">Voice Provider *</Label>
            <Select
              value={voiceProvider}
              onValueChange={(value) => {
                setVoiceProvider(value as VoiceProviderType);
                // Reset voiceId when provider changes
                setVoiceId('');
              }}
            >
              <SelectTrigger id="voice-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={VoiceProviderType.ELEVEN_LABS}>ElevenLabs</SelectItem>
                <SelectItem value={VoiceProviderType.KOKORO}>Kokoro/Chorus</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Voice ID Selection */}
          <div className="space-y-2">
            <Label htmlFor="voice-id">Voice *</Label>
            {voiceProvider === VoiceProviderType.ELEVEN_LABS ? (
              <Input
                id="voice-id"
                value={voiceId}
                onChange={(e) => setVoiceId(e.target.value)}
                placeholder="Enter ElevenLabs voice ID (e.g., 21m00Tcm4TlvDq8ikWAM)"
              />
            ) : (
              <Select value={voiceId} onValueChange={setVoiceId}>
                <SelectTrigger id="voice-id">
                  <SelectValue placeholder="Select a Kokoro voice" />
                </SelectTrigger>
                <SelectContent className="max-h-60">
                  {KOKORO_VOICES.map((voice) => (
                    <SelectItem key={voice.voiceId} value={voice.voiceId}>
                      {formatRegion(voice.language)} · {formatVoiceName(voice.voiceId)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Voice Parameters */}
          {voiceProvider === VoiceProviderType.ELEVEN_LABS && (
            <div className="space-y-4 border-t pt-4">
              <h4 className="text-sm font-medium">Voice Settings</h4>
              
              {/* Stability */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Stability</Label>
                  <span className="text-sm text-muted-foreground">{stability}</span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={[stability]}
                  onValueChange={([v]) => setStability(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>More Variable</span>
                  <span>More Stable</span>
                </div>
              </div>

              {/* Similarity Boost */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Clarity + Similarity</Label>
                  <span className="text-sm text-muted-foreground">{similarityBoost}</span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={[similarityBoost]}
                  onValueChange={([v]) => setSimilarityBoost(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>

              {/* Style */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Style Exaggeration</Label>
                  <span className="text-sm text-muted-foreground">{style}</span>
                </div>
                <Slider
                  min={0}
                  max={1}
                  step={0.1}
                  value={[style]}
                  onValueChange={([v]) => setStyle(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>None</span>
                  <span>Exaggerated</span>
                </div>
              </div>

              {/* Speed */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Speed</Label>
                  <span className="text-sm text-muted-foreground">{speed}</span>
                </div>
                <Slider
                  min={0.7}
                  max={1.2}
                  step={0.1}
                  value={[speed]}
                  onValueChange={([v]) => setSpeed(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Slowest</span>
                  <span>Fastest</span>
                </div>
              </div>

              {/* Latency */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Optimize Streaming Latency</Label>
                  <span className="text-sm text-muted-foreground">{optimizeStreamingLatency}</span>
                </div>
                <Slider
                  min={0}
                  max={4}
                  step={1}
                  value={[optimizeStreamingLatency]}
                  onValueChange={([v]) => setOptimizeStreamingLatency(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>More Latency</span>
                  <span>Less Latency</span>
                </div>
              </div>
            </div>
          )}

          {voiceProvider === VoiceProviderType.KOKORO && (
             <div className="space-y-4 border-t pt-4">
               <h4 className="text-sm font-medium">Voice Settings</h4>
               <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Speed</Label>
                  <span className="text-sm text-muted-foreground">{speed}</span>
                </div>
                <Slider
                  min={0.5}
                  max={2.0}
                  step={0.1}
                  value={[speed]}
                  onValueChange={([v]) => setSpeed(v)}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>0.5x</span>
                  <span>2.0x</span>
                </div>
              </div>
             </div>
          )}

        </div>

        <DialogFooter className="flex justify-between sm:justify-between">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={isPreviewPlaying ? handleStopPreview : handleVoicePreview}
            disabled={!voiceId || isPreviewLoading}
            title={isPreviewPlaying ? 'Stop preview' : 'Preview voice'}
            className="mr-auto"
          >
            {isPreviewLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isPreviewPlaying ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isValid}>
              {existingConfig ? 'Save Changes' : 'Add Personality'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
