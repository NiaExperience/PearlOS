/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { FeatureKey } from '@nia/features/feature-flags';
import { composeSystemPrompt } from '@nia/features/featurePrompts';
import { AssistantBlock } from "@nia/prism/core/blocks";
import { PersonalityVoiceConfig } from "@nia/prism/core/blocks/assistant.block";
import { Plus, Pencil, Trash2, Loader2, Info } from 'lucide-react';
import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';
import * as z from 'zod';

import { Button } from "@dashboard/components/ui/button";
import {
  FormControl,
  FormItem,
  FormLabel,
} from '@dashboard/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@dashboard/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@dashboard/components/ui/tooltip';
import { useToast } from "@dashboard/hooks/use-toast";
import { coerceFeatureKeyList } from '@dashboard/lib/assistant-feature-sync';

import { AddPersonalityVoiceDialog } from './add-personality-voice-dialog';
import { HighlightingTextarea } from './ui/highlighting-textarea';

type IAssistant = AssistantBlock.IAssistant;
const AssistantSchema = AssistantBlock.AssistantSchema;

/**
 * Fetch functional prompts from database and compose them
 * @param enabledFeatures - Array of enabled feature keys
 * @returns Composed functional prompt string
 */
async function composeFunctionalPromptFromDB(enabledFeatures: FeatureKey[]): Promise<string> {
  try {
    // Fetch all functional prompts from database
    const response = await fetch('/api/functionalPrompt');
    if (!response.ok) {
      console.warn('Failed to fetch functional prompts from database');
      return '';
    }
    
    const data = await response.json();
    const dbPrompts = data.items || [];
    
    // Build a map of featureKey -> promptContent
    const promptMap = new Map<string, string>();
    dbPrompts.forEach((p: { featureKey: string; promptContent: string }) => {
      if (p.featureKey && p.promptContent) {
        promptMap.set(p.featureKey, p.promptContent);
      }
    });
    
    // Compose prompts for enabled features
    let prompt = '';
    for (const feature of enabledFeatures) {
      if (promptMap.has(feature)) {
        prompt += promptMap.get(feature) + '\n\n';
      }
    }
    
    // Add built-in prompts (like desktopSwitching)
    if (promptMap.has('desktopSwitching')) {
      prompt += promptMap.get('desktopSwitching');
    }
    
    return prompt.trim();
  } catch (error) {
    console.error('Error fetching functional prompts:', error);
    return '';
  }
}

export default function AssistantPersonalityVoiceTab({
  selectedAssistant,
  form,
}: {
  selectedAssistant: IAssistant;
  form: UseFormReturn<z.infer<typeof AssistantSchema>>;
}) {
  const instanceId = useMemo(() => Math.random().toString(36).slice(2), []);
  const [activeConfigTab, setActiveConfigTab] = useState<'os' | 'dailyCall'>('os');
  
  // Personalities for selection
  type PersonalityItem = { _id: string; key: string; name?: string };
  const [personalities, setPersonalities] = useState<PersonalityItem[]>([]);
  const [loadingPersonalities, setLoadingPersonalities] = useState(false);
  const [allowedPersonalitiesDialog, setAllowedPersonalitiesDialog] = useState(false);
  const { toast } = useToast();

  // Prompt preview state
  const [computedSystemPrompt, setComputedSystemPrompt] = useState<string>('');
  const [buildingPrompt, setBuildingPrompt] = useState<boolean>(false);
  const [previewMode, setPreviewMode] = useState<string>('default');

  // Calculate effective personality ID for the selected preview mode
  const previewModeConfig = form.watch(`modePersonalityVoiceConfig.${previewMode}` as any);
  const defaultModeConfig = form.watch('modePersonalityVoiceConfig.default');
  const rootPid = form.watch('personalityId' as any);

  const watchedPersonalityId = useMemo(() => {
    let pid = previewModeConfig?.personalityId;
    
    if (!pid) {
      if (previewMode === 'default') {
        pid = rootPid;
      } else {
        // Fallback to default mode
        pid = defaultModeConfig?.personalityId || rootPid;
      }
    }
    return pid;
  }, [previewMode, previewModeConfig, defaultModeConfig, rootPid]);

  const watchedSupportedFeatures = form.watch('supportedFeatures');

  // Mode editing state
  const [editingMode, setEditingMode] = useState<string | null>(null);
  const [editingTab, setEditingTab] = useState<'os' | 'dailyCall'>('os');
  const [editingModeConfig, setEditingModeConfig] = useState<PersonalityVoiceConfig | undefined>(undefined);

  const handleEditMode = (mode: string, config: PersonalityVoiceConfig) => {
    setEditingMode(mode);
    setEditingModeConfig(config);
    setEditingTab(activeConfigTab);
    setAllowedPersonalitiesDialog(true);
  };

  const handleSaveDialog = (config: PersonalityVoiceConfig) => {
    if (editingMode) {
      // Saving a mode configuration
      const targetField = (editingTab || activeConfigTab) === 'dailyCall'
        ? 'dailyCallPersonalityVoiceConfig'
        : 'modePersonalityVoiceConfig';
      const currentModes = form.getValues(targetField as any) || {};
      const updatedModes = {
        ...currentModes,
        [editingMode]: {
          ...currentModes[editingMode],
          ...config,
        }
      };
      form.setValue(targetField as any, updatedModes as any, { shouldDirty: true });
    } else {
      // Saving to allowedPersonalities
      handleSavePersonalityVoice(config);
    }
    setEditingMode(null);
    setEditingTab('os');
    setEditingModeConfig(undefined);
    setAllowedPersonalitiesDialog(false);
  };

  // Helper: Generate composite key from personality config
  const generatePersonalityKey = useCallback((config: PersonalityVoiceConfig): string => {
    if (!config.voice) return `${config.personalityName}-unknown-voice`;
    return `${config.personalityName}-${config.voice.provider}-${config.voice.voiceId}`;
  }, []);

  // Helper: Check if a string is a UUID
  const isUUID = useCallback((str: string): boolean => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }, []);

  // Helper: Migrate allowedPersonalities from UUID keys to composite keys
  const migrateAllowedPersonalities = useCallback((allowedPersonalities: Record<string, PersonalityVoiceConfig>): Record<string, PersonalityVoiceConfig> => {
    const migrated: Record<string, PersonalityVoiceConfig> = {};
    let needsMigration = false;

    for (const [key, config] of Object.entries(allowedPersonalities)) {
      if (isUUID(key)) {
        // Old format: UUID key, migrate to composite key
        const newKey = generatePersonalityKey(config);
        migrated[newKey] = config;
        needsMigration = true;
      } else {
        // Already using composite key
        migrated[key] = config;
      }
    }

    if (needsMigration) {
      // eslint-disable-next-line no-console
      console.log('Migrated allowedPersonalities from UUID keys to composite keys');
    }

    return migrated;
  }, [isUUID, generatePersonalityKey]);

  // Handler for saving personality voice configuration
  const handleSavePersonalityVoice = (config: PersonalityVoiceConfig) => {
    const current = (form.getValues as any)('allowedPersonalities') || {};
    
    // Migrate any existing UUID keys before adding new entry
    const migratedCurrent = migrateAllowedPersonalities(current);
    
    // Use composite key: name-provider-voiceId
    const compositeKey = generatePersonalityKey(config);
    
    const updated = {
      ...migratedCurrent,
      [compositeKey]: config,
    };
    
    (form.setValue as any)('allowedPersonalities', updated, { shouldDirty: true });
    toast({
      title: 'Personality added',
      description: `${config.personalityName} with ${config.voice.provider} voice has been added.`,
    });
  };

  // Migrate allowedPersonalities from UUID keys to composite keys on form load
  useEffect(() => {
    const allowedPersonalities = (form.getValues as any)('allowedPersonalities');
    
    // Only process if we have the new object format (not array)
    if (allowedPersonalities && typeof allowedPersonalities === 'object' && !Array.isArray(allowedPersonalities)) {
      const migrated = migrateAllowedPersonalities(allowedPersonalities);
      
      // Check if any migration happened by comparing keys
      const originalKeys = Object.keys(allowedPersonalities).sort();
      const migratedKeys = Object.keys(migrated).sort();
      const changed = originalKeys.length !== migratedKeys.length || 
                      originalKeys.some((key, idx) => key !== migratedKeys[idx]);
      
      if (changed) {
        // Migration happened, update the form
        (form.setValue as any)('allowedPersonalities', migrated, { shouldDirty: true });
        toast({
          title: 'Personalities migrated',
          description: 'Personality configurations have been updated to the new format.',
        });
      }
    }
  }, [selectedAssistant, form, toast, migrateAllowedPersonalities]);

  // Load personalities for this assistant's tenant ONLY
  useEffect(() => {
    const fetchPersonalities = async () => {
      try {
        setLoadingPersonalities(true);
        const res = await fetch(`/api/personalities?tenantId=${selectedAssistant.tenantId}`);
        if (!res.ok) {
          setPersonalities([]);
          return;
        }
        const data = await res.json();
        const mapped: PersonalityItem[] = (data.items || []).map((it: any) => ({
          _id: it._id || it.page_id,
          key: it.key,
          name: it.name,
        })).sort((a: PersonalityItem, b: PersonalityItem) => (a.name || a.key).localeCompare(b.name || b.key));
        setPersonalities(mapped);
      } catch (e) {
        console.error('Failed to load personalities', e);
        setPersonalities([]);
      } finally {
        setLoadingPersonalities(false);
      }
    };
    fetchPersonalities();
  }, [selectedAssistant.tenantId]);

  // Build functional/system prompt for the available/valid personality
  useEffect(() => {
    const targetPersonalityId = watchedPersonalityId;
    
    if (targetPersonalityId && personalities.some(p => p._id === targetPersonalityId)) {
      let cancelled = false;
      const buildPrompt = async () => {
        try {
          setBuildingPrompt(true);
          
          // Fetch functional prompts from database
          const functionalPrompt = await composeFunctionalPromptFromDB((watchedSupportedFeatures as FeatureKey[]) || []);
          
          // Fetch personality
          const res = await fetch(`/api/personalities/${targetPersonalityId}?tenantId=${selectedAssistant.tenantId}`);
          let systemPromptLocal = functionalPrompt;
          if (res.ok) {
            const data = await res.json();
            // API returns { item } shape; fall back to raw if needed
            const personality = (data && (data.item ?? data)) as any;
            if (!cancelled && personality) {
              systemPromptLocal = composeSystemPrompt(
                personality,
                { username: 'Example Bob LobLaw', userProfile: { 'example_average_day': 'Lawyering' } },
              );
            }
          }
          if (!cancelled) {
            setComputedSystemPrompt(systemPromptLocal);
          }
        } catch (e) {
          if (!cancelled) {
            const fallback = await composeFunctionalPromptFromDB((watchedSupportedFeatures as FeatureKey[]) || []);
            setComputedSystemPrompt(fallback);
            // eslint-disable-next-line no-console
            console.warn('Personality composition failed, using base prompt.', e);
          }
        } finally {
          if (!cancelled) setBuildingPrompt(false);
        }
      };
      void buildPrompt();
      return () => { cancelled = true; };
    } else {
      // No valid personality—fallback to functional prompt only
      let cancelled = false;
      const loadFallback = async () => {
        const fallback = await composeFunctionalPromptFromDB((watchedSupportedFeatures as FeatureKey[]) || []);
        if (!cancelled) {
          setComputedSystemPrompt(fallback);
        }
      };
      void loadFallback();
      return () => { cancelled = true; };
    }
  }, [personalities, selectedAssistant.tenantId, watchedPersonalityId, watchedSupportedFeatures]);

  return (
    <div className='p-6 space-y-6 bg-background text-foreground'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-lg font-semibold'>Personality & Voice</h2>
          <p className='text-sm text-muted-foreground'>
            Configure personalities and voices for different modes.
          </p>
        </div>
      </div>

      <div className='space-y-6 border p-6 rounded-lg bg-muted/50'>
        {/* Config Tabs */}
        <div className="flex items-center gap-2 mb-4">
          <Button
            type="button"
            size="sm"
            variant={activeConfigTab === 'os' ? 'default' : 'outline'}
            onClick={() => setActiveConfigTab('os')}
          >
            OS
          </Button>
          <Button
            type="button"
            size="sm"
            variant={activeConfigTab === 'dailyCall' ? 'default' : 'outline'}
            onClick={() => setActiveConfigTab('dailyCall')}
          >
            Social/DailyCall
          </Button>
        </div>

        {/* Mode Configuration Table - OS */}
        {activeConfigTab === 'os' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">OS Mode Configuration</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mode</TableHead>
                  <TableHead>Persona</TableHead>
                  <TableHead>Personality</TableHead>
                  <TableHead>Voice</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {['default', 'home', 'work', 'creative', 'gaming', 'focus', 'relaxation', 'quiet'].map((mode) => {
                  // Future modes that aren't switchable via desktop taskbar yet
                  const isFutureMode = ['gaming', 'focus', 'relaxation'].includes(mode);
                  const modeConfig = form.watch(`modePersonalityVoiceConfig.${mode}`);
                  
                  // Resolve effective config for display
                  let displayConfig = modeConfig;
                  let isInherited = false;

                  if (!displayConfig || (mode === 'default' && !displayConfig.personalityId)) {
                    if (mode === 'default') {
                      // Fallback to root properties for default mode (legacy support)
                      const rootPid = form.watch('personalityId' as any);
                      const rootVoice = form.watch('voice' as any);
                      if (rootPid) {
                        const pName = personalities.find(p => p._id === rootPid)?.name || rootPid;
                        displayConfig = {
                          ...(displayConfig || {}),
                          personalityId: rootPid,
                          personalityName: pName,
                          voice: displayConfig?.voice || rootVoice
                        } as any;
                      }
                    } else if (!displayConfig) {
                      // Fallback to default mode for other modes
                      const defaultConfig = form.watch('modePersonalityVoiceConfig.default');
                      if (defaultConfig) {
                        displayConfig = { ...defaultConfig };
                        isInherited = true;
                      } else {
                        // Fallback to root properties if default mode is also missing
                        const rootPid = form.watch('personalityId' as any);
                        const rootVoice = form.watch('voice' as any);
                        if (rootPid) {
                          const pName = personalities.find(p => p._id === rootPid)?.name || rootPid;
                          displayConfig = {
                            personalityId: rootPid,
                            personalityName: pName,
                            voice: rootVoice
                          } as any;
                          isInherited = true;
                        }
                      }
                    }
                  }

                  // Ensure personality name is resolved if we have an ID but no name
                  if (displayConfig?.personalityId && !displayConfig.personalityName) {
                    const configId = displayConfig.personalityId;
                    const pName = personalities.find(p => p._id === configId)?.name;
                    if (pName) {
                      displayConfig = { ...displayConfig, personalityName: pName };
                    }
                  }

                  // Force update name if it matches ID (fallback case) and we have the real name now
                  if (displayConfig?.personalityId && displayConfig.personalityName === displayConfig.personalityId) {
                     const configId = displayConfig.personalityId;
                     const pName = personalities.find(p => p._id === configId)?.name;
                     if (pName) {
                       displayConfig = { ...displayConfig, personalityName: pName };
                     }
                  }

                  return (
                    <TableRow 
                      key={mode}
                      className={`cursor-pointer transition-colors hover:bg-muted/50 ${previewMode === mode ? 'bg-muted border-l-2 border-primary' : ''} ${isFutureMode ? 'opacity-50' : ''}`}
                      onClick={() => !isFutureMode && setPreviewMode(mode)}
                    >
                      <TableCell className="font-medium capitalize">
                        {mode ==='default' ? 'Default/Onboarding' : mode}
                        {isFutureMode && <span className="text-xs text-muted-foreground ml-2 italic">(Future)</span>}
                        {isInherited && !isFutureMode && <span className="text-xs text-muted-foreground ml-2">(Inherited)</span>}
                      </TableCell>
                      <TableCell>{isFutureMode ? '-' : (displayConfig?.personaName || '-')}</TableCell>
                      <TableCell className="whitespace-normal break-words max-w-[200px]">{isFutureMode ? '-' : (displayConfig?.personalityName || '-')}</TableCell>
                      <TableCell>
                        {!isFutureMode && displayConfig?.voice ? (
                           <div className="flex flex-col">
                             <span>{displayConfig.voice.provider}</span>
                             <span className="text-xs text-muted-foreground">{displayConfig.voice.voiceId}</span>
                           </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {!isFutureMode && displayConfig && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditMode(mode, displayConfig)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Mode Configuration Table - Social/DailyCall */}
        {activeConfigTab === 'dailyCall' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Social/DailyCall Configuration</h3>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mode</TableHead>
                  <TableHead>Persona</TableHead>
                  <TableHead>Personality</TableHead>
                  <TableHead>Voice</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...new Set(['default', ...Object.keys(form.watch('dailyCallPersonalityVoiceConfig') || {})])].map((mode) => {
                  const modeConfig = form.watch(`dailyCallPersonalityVoiceConfig.${mode}` as any);
                  let displayConfig = modeConfig;
                  let isInherited = false;

                  if (!displayConfig && mode !== 'default') {
                    const defaultConfig = form.watch('dailyCallPersonalityVoiceConfig.default' as any);
                    if (defaultConfig) {
                      displayConfig = { ...defaultConfig };
                      isInherited = true;
                    }
                  }

                  if (displayConfig?.personalityId && !displayConfig.personalityName) {
                    const pName = personalities.find(p => p._id === displayConfig.personalityId)?.name;
                    if (pName) {
                      displayConfig = { ...displayConfig, personalityName: pName };
                    }
                  }

                  return (
                    <TableRow key={`${mode}-daily`} className="cursor-pointer transition-colors hover:bg-muted/50">
                      <TableCell className="font-medium capitalize">
                        {mode}
                        {isInherited && <span className="text-xs text-muted-foreground ml-2">(Inherited)</span>}
                      </TableCell>
                      <TableCell>{displayConfig?.personaName || '-'}</TableCell>
                      <TableCell className="whitespace-normal break-words max-w-[200px]">{displayConfig?.personalityName || '-'}</TableCell>
                      <TableCell>
                        {displayConfig?.voice ? (
                           <div className="flex flex-col">
                             <span>{displayConfig.voice.provider}</span>
                             <span className="text-xs text-muted-foreground">{displayConfig.voice.voiceId}</span>
                           </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {displayConfig && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditMode(mode, displayConfig)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {/* User-Selectable Personalities (Unused at present)
        <div className="space-y-4 pt-6 border-t">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">User-Selectable Personalities</h3>
              <p className="text-sm text-muted-foreground">
                Additional personalities available for users to switch to.
              </p>
            </div>
            <Button onClick={() => setAllowedPersonalitiesDialog(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" /> Add Personality
            </Button>
          </div>
          
          <div className="grid grid-cols-1 gap-4">
            {Object.entries((form.watch('allowedPersonalities') || {})).map(([key, config]) => (
              <div key={key} className="flex items-center justify-between p-4 border rounded-lg bg-card">
                <div>
                  <div className="font-medium">{config.personalityName}</div>
                  <div className="text-sm text-muted-foreground">
                    {config.voice ? `${config.voice.provider} • ${config.voice.voiceId}` : 'Voice not configured'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const current = form.getValues('allowedPersonalities');
                    if (!current) return;
                    const { [key]: removed, ...rest } = current;
                    form.setValue('allowedPersonalities', rest, { shouldDirty: true });
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {Object.keys(form.watch('allowedPersonalities') || {}).length === 0 && (
              <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
                No additional personalities configured.
              </div>
            )}
          </div>
        </div>
        */}

        {/* OS System Prompt Preview */}
        {activeConfigTab === 'os' && (
          <div className="space-y-4 pt-6 border-t">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-medium flex items-center gap-2">
                  Prompt for <span className="font-bold capitalize">{previewMode}</span>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className='h-4 w-4 text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>System instructions for the AI model:</p><br />
                        <p>This field is composed of prompts wired to feature flags,<br />
                          built-in functions, and the selected personality.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </h3>
                <p className="text-sm text-muted-foreground">
                  Preview of the composed system prompt based on the selected mode&apos;s personality.
                  <span className="italic ml-1">(edit in Personalities page)</span>
                </p>
              </div>
            </div>
            
            <div>
              <HighlightingTextarea
                value={computedSystemPrompt}
                onChange={() => { /* read-only */ }}
                searchTerm=""
                heightPx={200}
                className='w-full rounded-md border border-input bg-muted px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none cursor-not-allowed select-text'
              />
              {buildingPrompt && (
                <div className='mt-1 flex items-center gap-2 text-xs text-muted-foreground'>
                  <Loader2 className='h-3 w-3 animate-spin' /> Composing…
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Personality Voice Dialog */}
      <AddPersonalityVoiceDialog
        open={allowedPersonalitiesDialog}
        onOpenChange={(open) => {
            setAllowedPersonalitiesDialog(open);
            if (!open) {
                setEditingMode(null);
                setEditingModeConfig(undefined);
            }
        }}
        tenantId={selectedAssistant.tenantId}
        onSave={handleSaveDialog}
        existingConfig={editingModeConfig}
      />
    </div>
  );
}
