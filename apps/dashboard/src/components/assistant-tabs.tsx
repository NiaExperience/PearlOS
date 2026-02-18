'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { AssistantAccessFeatures } from '@nia/prism/core/utils/assistant-login';
import {
  Brain,
  Database,
  ActivityIcon as Function,
  Logs,
  Mic,
  Pencil,
  Save,
  Settings,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { FieldErrors, useForm } from 'react-hook-form';
import { z } from 'zod';

import { useToast } from '@dashboard/hooks/use-toast';
import { coerceFeatureKeyList } from '@dashboard/lib/assistant-feature-sync';
import { normalizeSupportedFeatures } from '@dashboard/lib/feature-normalization';
import { Tab } from '@dashboard/types/tabs.types';

import AssistantAdvancedTab from './assistant-advanced-tab';
import AssistantContentTab from './assistant-content-tab';
import AssistantModelTab from './assistant-model-tab';
import AssistantPersonalityVoiceTab from './assistant-personality-voice-tab';
import AssistantTranscriberTab from './assistant-transcriber-tab';
import { Button } from './ui/button';
import { Form } from './ui/form';
import { Input } from './ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';

// Define a minimal IAssistant type and schema for client use
interface IAssistant {
  _id?: string;
  name: string;
  tenantId: string;
  supportedFeatures?: string[];
  startFullScreen?: boolean;
  // Add other fields as needed
}

const AssistantSchema = z
  .object({
    name: z.string().min(1, 'Name is required'),
    tenantId: z.string(),
    startFullScreen: z.boolean().optional(),
    // Add other fields as needed
  })
  .passthrough();

type AssistantFormValues = z.infer<typeof AssistantSchema>;

const tabs: Tab[] = [
  {
    value: 'personality-voice',
    label: 'Personality/Voice',
    icon: Mic,
  },
  {
    value: 'model',
    label: 'Model',
    icon: Brain,
  },
  {
    value: 'transcriber',
    label: 'Transcriber',
    icon: Logs,
  },
  {
    value: 'advanced',
    label: 'Advanced',
    icon: Settings,
  },
  {
    value: 'content',
    label: 'Content',
    icon: Database,
  },
];

export const AssistantTabs = ({ assistant }: { assistant: IAssistant }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [assistantName, setAssistantName] = useState(assistant.name);
  const [activeTab, setActiveTab] = useState<string>('personality-voice');

  // Apply UI defaults: if supportedFeatures is missing/empty, enable all features for the form state
  const normalizedDefaults = useMemo(() => {
    const base = assistant as unknown as AssistantFormValues;
    return {
      ...base,
      supportedFeatures: normalizeSupportedFeatures(
        assistant as AssistantAccessFeatures,
        assistant.supportedFeatures
      ),
    };
  }, [assistant]);

  const form = useForm<AssistantFormValues>({
    resolver: zodResolver(AssistantSchema),
    // Hydrate with full assistant object so nested tabs (voice/model/etc.) have values
    defaultValues: normalizedDefaults,
  });

  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    // Reset with full object to keep nested values (voice/model/etc.) in state
    form.reset(normalizedDefaults);
  }, [form, normalizedDefaults]);

  async function handleNameUpdate(values: { name: string }) {
    if (!values.name.trim()) {
      toast({
        title: 'Error',
        description: 'Assistant name cannot be empty.',
      });
      return;
    }
    try {
      setIsLoading(true);
      const response = await fetch('/api/assistant/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant._id, ...values }),
      });
      if (response.ok) {
        const data = await response.json();
        toast({
          title: `Assistant ${data.assistant.name} updated successfully`,
          description: 'The assistant has been updated.',
        });
        setIsEditing(false);
        setAssistantName(data.assistant.name);
        // Refresh to pick up any server-side recompositions and keep derived UI in sync
        router.refresh();
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to update assistant.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update assistant.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function onSubmit(values: AssistantFormValues) {
    setIsLoading(true);
    try {
      const normalizedSupportedRaw = Array.isArray(values.supportedFeatures)
        ? values.supportedFeatures.filter((item): item is string => typeof item === 'string')
        : [];
      const normalizedSupported = coerceFeatureKeyList(normalizedSupportedRaw);

      values.supportedFeatures = normalizedSupported;
      (values as Record<string, unknown>).allowAnonymousLogin = normalizedSupported.includes('guestLogin');

      // Phase 2.3: Ensure modePersonalityVoiceConfig['default'] is populated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyValues = values as any;
      if (!anyValues.modePersonalityVoiceConfig) {
        anyValues.modePersonalityVoiceConfig = {};
      }
      
      if (!anyValues.modePersonalityVoiceConfig.default) {
         // Try to populate from root fields if they exist (migration/fallback)
         if (anyValues.personalityId) {
             anyValues.modePersonalityVoiceConfig.default = {
                 personalityId: anyValues.personalityId,
                 personalityName: anyValues.persona_name || 'Default',
                 voice: anyValues.voice
             };
         }
      }

      // Enforce personality selection before saving
      const personalityId = anyValues.modePersonalityVoiceConfig?.default?.personalityId;
      if (!personalityId || (typeof personalityId === 'string' && personalityId.trim() === '')) {
        toast({
          title: 'Missing personality',
          description: 'Please select a personality in the Personality/Voice tab before saving.',
        });
        setIsLoading(false);
        return;
      }

      // Phase 2.3: Filter out root personalityId, persona_name, voice from submission
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { personalityId: _pid, persona_name: _pname, voice: _voice, ...payload } = anyValues;

      const response = await fetch('/api/assistant/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant._id, ...payload }),
      });
      if (response.ok) {
        const data = await response.json();
        toast({
          title: `Assistant ${data.assistant.name} updated successfully`,
          description: 'The assistant has been updated.',
        });
        // Force a refresh so dependent tabs (e.g., Model) recompute composed prompts
        router.refresh();
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to update assistant.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update assistant.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  function onError(errors: FieldErrors<AssistantFormValues>) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('Form validation errors', errors);
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onError)}>
        <div className="px-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {isEditing ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={assistantName}
                    onChange={e => setAssistantName(e.target.value)}
                    className="h-8 w-[200px]"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleNameUpdate({ name: assistantName });
                      }
                      if (e.key === 'Escape') {
                        setIsEditing(false);
                        setAssistantName(assistant.name);
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      handleNameUpdate({ name: assistantName });
                    }}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsEditing(false);
                      setAssistantName(assistant.name);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <h2 className="text-2xl font-semibold tracking-tight text-cyan-500">
                  {assistant.name}
                </h2>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isEditing) {
                    setAssistantName(assistant.name);
                  }
                  setIsEditing(!isEditing);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">Configure your assistant settings</p>
          </div>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full pt-4">
          <div className="flex w-full items-center justify-between gap-2 px-4">
            <TabsList className="h-12 items-center justify-center rounded-lg p-2">
              {tabs.map(tab => (
                <TabsTrigger key={tab.value} value={tab.value} className="h-full w-40 flex-1">
                  <div className="flex items-center justify-center gap-2">
                    <tab.icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </div>
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                type="submit"
                disabled={isLoading}
                className="bg-gradient-to-r from-[#0097B2] to-[#003E49] text-white hover:from-[#008299] hover:to-[#00313A]"
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    <span>Saving...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span>Save Changes</span>
                    <Save className="h-4 w-4" />
                  </div>
                )}
              </Button>
            </div>
          </div>

          <TabsContent value="personality-voice">
            <AssistantPersonalityVoiceTab form={form} selectedAssistant={assistant} />
          </TabsContent>

          <TabsContent value="model">
            <AssistantModelTab form={form} selectedAssistant={assistant} />
          </TabsContent>

          <TabsContent value="transcriber">
            <AssistantTranscriberTab form={form} selectedAssistant={assistant} />
          </TabsContent>

          <TabsContent value="advanced">
            <AssistantAdvancedTab form={form} selectedAssistant={assistant} />
          </TabsContent>

          <TabsContent value="content">
            <AssistantContentTab form={form} selectedAssistant={assistant} />
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
};
