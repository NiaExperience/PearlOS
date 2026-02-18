/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { FeatureKey } from '@nia/features/feature-flags';
import { AssistantBlock } from "@nia/prism/core/blocks";
import { Info, Search, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import * as React from 'react';
import { useEffect, useMemo, useState } from 'react';
import { UseFormReturn, useFieldArray } from 'react-hook-form';
import * as z from 'zod';

import { Button } from "@dashboard/components/ui/button";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@dashboard/components/ui/form';
import { Input } from '@dashboard/components/ui/input';
import { Slider } from '@dashboard/components/ui/slider';
import { Switch } from '@dashboard/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@dashboard/components/ui/tooltip';
import { useToast } from '@dashboard/hooks/use-toast';
import {
  coerceFeatureKeyList,
  featureListsEqual,
} from '@dashboard/lib/assistant-feature-sync';

type IAssistant = AssistantBlock.IAssistant;
const AssistantSchema = AssistantBlock.AssistantSchema;

const DEFAULT_GENERATION_CHAIN = [
  {
    provider: 'openai',
    model: 'gpt-5.1-codex-max',
  },
  {
    provider: 'google',
    model: 'gemini-3-pro',
  },
  {
    provider: 'openai',
    model: 'gpt-5',
  },
  {
    provider: 'google',
    model: 'gemini-2.5-pro',
  },
  {
    provider: 'anthropic',
    model: 'claude-4-5-sonnet-20250921',
  },
  {
    provider: 'anthropic',
    model: 'claude-4-5-opus-20250829',
  },
  {
    provider: 'openai',
    model: 'gpt-4o',
  },
];

export default function AssistantModelTab({
  selectedAssistant,
  form,
}: {
  selectedAssistant: IAssistant;
  form: UseFormReturn<z.infer<typeof AssistantSchema>>;
}) {
  const { toast } = useToast();
  const instanceId = useMemo(() => Math.random().toString(36).slice(2), []);
  console.log(`AssistantModelTab RENDERED ${instanceId} tenant=${selectedAssistant?.tenantId}`);

  const { fields, append, remove, replace, move } = useFieldArray({
    control: form.control,
    name: "generationModelConfig",
  });
  
  // Personalities for selection in Model tab
  type PersonalityItem = { _id: string; key: string; name?: string };
  const [personalities, setPersonalities] = useState<PersonalityItem[]>([]);
  const [loadingPersonalities, setLoadingPersonalities] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);

  const formValues = form.watch();
  const saPersonalityId = (selectedAssistant as any)?.modePersonalityVoiceConfig?.default?.personalityId;
  const watchedSupportedFeatures = form.watch('supportedFeatures');
  const normalizedSupportedFeatures = useMemo(
    () => coerceFeatureKeyList(watchedSupportedFeatures),
    [watchedSupportedFeatures],
  );

  // Initialize personalityId from the selected assistant if form has none yet
  useEffect(() => {
    if (selectedAssistant && saPersonalityId) {
      const current = form.getValues('modePersonalityVoiceConfig.default.personalityId');
      if (!current || (typeof current === 'string' && current.trim() === '')) {
        form.setValue('modePersonalityVoiceConfig.default.personalityId', saPersonalityId, { shouldDirty: false, shouldValidate: false });
      }
    }
  }, [selectedAssistant, saPersonalityId, form]);

  useEffect(() => {
    if (!Array.isArray(watchedSupportedFeatures) && normalizedSupportedFeatures.length === 0) {
      return;
    }

    if (
      !Array.isArray(watchedSupportedFeatures) ||
      !featureListsEqual(normalizedSupportedFeatures, watchedSupportedFeatures as FeatureKey[])
    ) {
      form.setValue('supportedFeatures', normalizedSupportedFeatures, { shouldDirty: true });
    }
  }, [form, normalizedSupportedFeatures, watchedSupportedFeatures]);

  // Initialize persona_name from the selected assistant name if persona_name is blank
  useEffect(() => {
    if (selectedAssistant) {
      const currentPersonaName = form.getValues('modePersonalityVoiceConfig.default.personaName');
      const assistantPersonaName = (selectedAssistant as any)?.modePersonalityVoiceConfig?.default?.personaName;
      
      // If there's no persona_name in the form and no saved persona_name, default to assistant.name
      if ((!currentPersonaName || currentPersonaName.trim() === '') && 
          (!assistantPersonaName || assistantPersonaName.trim() === '')) {
        form.setValue('modePersonalityVoiceConfig.default.personaName', selectedAssistant.name, { shouldDirty: false, shouldValidate: false });
      } else if (assistantPersonaName && (!currentPersonaName || currentPersonaName.trim() === '')) {
        // If there's a saved persona_name but form is empty, use the saved value
        form.setValue('modePersonalityVoiceConfig.default.personaName', assistantPersonaName, { shouldDirty: false, shouldValidate: false });
      }
    }
  }, [selectedAssistant, form]);

  // After personalities load, ensure the assistant's personalityId is applied if still unset
  useEffect(() => {
    if (!personalities || personalities.length === 0) return;
    const current = form.getValues('modePersonalityVoiceConfig.default.personalityId');
    const assistantPersonalityId = (selectedAssistant as any)?.modePersonalityVoiceConfig?.default?.personalityId;
    const targetPersonalityId = current && current !== ''
      ? current
      : assistantPersonalityId;

    // If form is missing a value but the assistant has one (and it's valid), set it once
    if ((!current || current === '') && targetPersonalityId && personalities.some(p => p._id === targetPersonalityId)) {
      form.setValue('modePersonalityVoiceConfig.default.personalityId', targetPersonalityId, { shouldDirty: false, shouldValidate: false });
    }
  }, [personalities, selectedAssistant, form]);

  useEffect(() => {
    // Clean up previously styled matches
    document.querySelectorAll('[data-match-styled="true"]').forEach(el => {
      const match = el as HTMLElement;
      match.style.backgroundColor = '';
      match.style.color = '';
      match.removeAttribute('data-match-styled');
    });

    if (!searchTerm.trim()) {
      if (matchCount !== 0) setMatchCount(0);
      if (matchIndex !== 0) setMatchIndex(0);
      return;
    }

    const allMatches = Array.from(document.querySelectorAll('[data-match="true"]')) as HTMLElement[];
    if (allMatches.length !== matchCount) {
      setMatchCount(allMatches.length);
    }

    if (allMatches.length === 0) {
      if (matchIndex !== 0) setMatchIndex(0);
      return;
    }

    const newMatchIndex = Math.max(0, Math.min(matchIndex, allMatches.length - 1));
    if (newMatchIndex !== matchIndex) {
      setMatchIndex(newMatchIndex);
      return; // Effect will re-run with the correct index.
    }

    allMatches.forEach((match, index) => {
      match.style.backgroundColor = index === newMatchIndex ? 'orange' : 'yellow';
      match.style.color = 'black';
      match.setAttribute('data-match-styled', 'true');
    });

    if (allMatches.length > 0 && allMatches[newMatchIndex]) {
      const targetElement = allMatches[newMatchIndex];
      const parentSelectContent = targetElement.closest('[data-radix-select-content]');
      if (!parentSelectContent || document.body.contains(parentSelectContent)) {
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [searchTerm, matchIndex, matchCount, formValues]);

  const getHighlightedText = (text: string | undefined, highlight: string) => {
    if (!highlight.trim() || !text) {
      return <span>{text}</span>;
    }
    const parts = text.split(new RegExp(`(${highlight})`, 'gi'));
    return (
      <span>
        {parts.map((part, i) =>
          part.toLowerCase() === highlight.toLowerCase() ? (
            <span key={i} data-match="true">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
    );
  };

  const isMatch = (text: string | undefined | number) => {
    if (!searchTerm.trim() || text === undefined) return false;
    return text.toString().toLowerCase().includes(searchTerm.toLowerCase());
  };



  // Load personalities for this assistant's tenant ONLY (previous implementation used /api/contentList which could be broader)
  useEffect(() => {
    console.log(`AssistantModelTab MOUNTED ${instanceId}`);
    return () => console.log(`AssistantModelTab UNMOUNTED ${instanceId}`);
  }, [instanceId]);

  useEffect(() => {
    const fetchPersonalities = async () => {
      try {
        console.log(`Fetching personalities for tenant: ${selectedAssistant.tenantId} instance=${instanceId}`);
        setLoadingPersonalities(true);
        const res = await fetch(`/api/personalities?tenantId=${selectedAssistant.tenantId}`);
        if (!res.ok) {
          console.log(`Fetch failed with status: ${res.status} instance=${instanceId}`);
          setPersonalities([]);
          return;
        }
        const data = await res.json();
        console.log(`Fetched personalities data: ${JSON.stringify(data)} instance=${instanceId}`);
        const mapped: PersonalityItem[] = (data.items || []).map((it: any) => ({
          _id: it._id || it.page_id,
          key: it.key,
          name: it.name,
  })).sort((a: PersonalityItem, b: PersonalityItem) => (a.name || a.key).localeCompare(b.name || b.key));
        console.log(`Mapped personalities: ${JSON.stringify(mapped)} instance=${instanceId}`);
        setPersonalities(mapped);
        console.log(`CALLED setPersonalities with ${mapped.length} items instance=${instanceId}`);
        
        // If current selection is not in this tenant's list, clear it to avoid cross-tenant leakage
        const currentId = form.getValues('modePersonalityVoiceConfig.default.personalityId');
        if (currentId && !mapped.some(p => p._id === currentId)) {
          form.setValue('modePersonalityVoiceConfig.default.personalityId', undefined as any, { shouldDirty: true });
          toast({ title: 'Personality reset', description: 'Previous personality not in tenant; selection cleared.' });
        }
      } catch (e) {
        console.error('Failed to load personalities', e);
        setPersonalities([]);
      } finally {
        setLoadingPersonalities(false);
      }
    };
    fetchPersonalities();
    return () => console.log(`fetchPersonalities effect CLEANUP instance=${instanceId}`);
  }, [selectedAssistant.tenantId, form, toast, instanceId]);

  const handlePrevMatch = () => {
    if (matchCount > 0) {
      setMatchIndex((prevIndex) => (prevIndex > 0 ? prevIndex - 1 : matchCount - 1));
    }
  };

  const handleNextMatch = () => {
    if (matchCount > 0) {
      setMatchIndex((prevIndex) => (prevIndex < matchCount - 1 ? prevIndex + 1 : 0));
    }
  };

  return (
    <div className='p-6 space-y-6 bg-background text-foreground'>
      <div className='flex items-center justify-between'>
        <div>
          <h2 className='text-lg font-semibold'>Model</h2>
          <p className='text-sm text-muted-foreground'>
            This section allows you to configure the model for the assistant.
          </p>
        </div>
      </div>
      <div className="sticky top-0 z-10 bg-background py-4 flex items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search all settings..."
            value={searchTerm}
            onChange={(e) => {
                setSearchTerm(e.target.value)
                setMatchIndex(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleNextMatch();
              }
            }}
            className="pl-10"
          />
        </div>
        <Button type="button" onClick={handlePrevMatch} disabled={matchCount === 0} variant="outline" size="sm">Prev</Button>
        <Button type="button" onClick={handleNextMatch} disabled={matchCount === 0} variant="outline" size="sm">Next</Button>
        {searchTerm && (
          <span className="text-sm text-muted-foreground">
            {matchCount > 0 ? `${matchIndex + 1} of ${matchCount}` : '0 of 0'}
          </span>
        )}
      </div>

      <div className='grid grid-cols-3 gap-6 border p-6 rounded-lg bg-muted/50'>
        <div className='space-y-6'>
          <FormField
            control={form.control}
            name='model.provider'
            defaultValue={selectedAssistant?.model?.provider}
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  {getHighlightedText('Provider', searchTerm)}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className='h-4 w-4 text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Default: openai</p>
                        <p>Examples: openai, anthropic, google, groq, deep-seek, xai</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </FormLabel>
                <FormControl>
                  <Input {...field} placeholder="openai" className={isMatch(field.value) ? 'border-2 border-yellow-400' : ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='model.model'
            defaultValue={selectedAssistant?.model?.model}
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  {getHighlightedText('Model', searchTerm)}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className='h-4 w-4 text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Default: gpt-4o-mini</p>
                        <p>Examples: gpt-4o-mini, claude-3-sonnet-20240229, gemini-1.5-pro, llama-3.1-70b-versatile</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </FormLabel>
                <FormControl>
                  <Input {...field} placeholder="gpt-4o-mini" className={isMatch(field.value) ? 'border-2 border-yellow-400' : ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className='space-y-4'>
          <div className='flex items-center justify-between'>
            <FormLabel className='text-base font-semibold'>
              {getHighlightedText('Generation Model Config', searchTerm)}
            </FormLabel>
            <div className="flex items-center gap-2">
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => replace(DEFAULT_GENERATION_CHAIN)}
              >
                Set to Defaults
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() => append({ provider: '', model: '' })}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add Config
              </Button>
            </div>
          </div>
          <div className='space-y-2'>
            {fields.map((field, index) => (
              <div key={field.id} className='flex items-start gap-2'>
                <div className='flex flex-col gap-1'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6'
                    onClick={() => move(index, index - 1)}
                    disabled={index === 0}
                  >
                    <ArrowUp className='h-3 w-3' />
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-6 w-6'
                    onClick={() => move(index, index + 1)}
                    disabled={index === fields.length - 1}
                  >
                    <ArrowDown className='h-3 w-3' />
                  </Button>
                </div>
                <FormField
                  control={form.control}
                  name={`generationModelConfig.${index}.provider`}
                  render={({ field }) => (
                    <FormItem className='flex-1'>
                      <FormControl>
                        <Input {...field} placeholder='Provider' className={isMatch(field.value) ? 'border-2 border-yellow-400' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name={`generationModelConfig.${index}.model`}
                  render={({ field }) => (
                    <FormItem className='flex-1'>
                      <FormControl>
                        <Input {...field} placeholder='Model' className={isMatch(field.value) ? 'border-2 border-yellow-400' : ''} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button
                  type='button'
                  variant='ghost'
                  size='icon'
                  onClick={() => remove(index)}
                  className='mt-0.5'
                >
                  <Trash2 className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                </Button>
              </div>
            ))}
            {fields.length === 0 && (
              <p className='text-sm text-muted-foreground italic'>No configuration added.</p>
            )}
          </div>
        </div>

        <div className='space-y-6'>
          <FormField
            control={form.control}
            name='model.temperature'
            defaultValue={selectedAssistant?.model?.temperature ?? 0.7}
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  {getHighlightedText('Temperature', searchTerm)}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className='h-4 w-4 text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Controls randomness in the output</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </FormLabel>
                <FormControl>
                  <div className='flex items-center gap-4'>
                    <Slider
                      min={0}
                      max={1}
                      step={0.1}
                      value={[field.value ?? 0.7]}
                      onValueChange={([value]) => field.onChange(value)}
                      className='flex-1'
                    />
                    <span className='w-12 text-sm'>{field.value}</span>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='model.maxTokens'
            defaultValue={selectedAssistant?.model?.maxTokens ?? 250}
            render={({ field }) => (
              <FormItem>
                <FormLabel className='flex items-center gap-2'>
                  {getHighlightedText('Max Tokens', searchTerm)}
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className='h-4 w-4 text-muted-foreground' />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Maximum number of tokens in the response</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    onChange={(event) => field.onChange(+event.target.value)}
                    className={isMatch(field.value) ? 'border-2 border-yellow-400' : ''}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='emotionRecognitionEnabled'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between rounded-lg border p-4'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>{getHighlightedText('Detect Emotion', searchTerm)}</FormLabel>
                  <FormDescription>
                    {getHighlightedText('Enable emotion detection in responses', searchTerm)}
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  );
}
