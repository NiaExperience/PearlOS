'use client';

import type { FeatureKey } from '@nia/features';
import { FeatureKeys, featureRegistry } from '@nia/features';
import { AssistantBlock } from '@nia/prism/core/blocks';
import { IDynamicContent } from '@nia/prism/core/blocks/dynamicContent.block';
import { Copy, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';

import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@dashboard/components/ui/form';
import { clientMessagesOptions, serverMessagesOptions } from '@dashboard/config/form.config';
import { LOGIN_FEATURE_METADATA, type LoginFeatureKey } from '@dashboard/lib/feature-normalization';

import { FancyMultiSelect } from './multi-select';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Switch } from './ui/switch';
import { Textarea } from './ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface AssistantAdvancedTabProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: UseFormReturn<any>; // Replace 'any' with your actual form type
  selectedAssistant: AssistantBlock.IAssistant;
  children?: React.ReactNode; // Add this line to accept children
}

function SyncTemplatesButton() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{
    success: boolean;
    message: string;
    templatesUpdated?: number;
  } | null>(null);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncResult(null);
    
    try {
      const response = await fetch('/api/admin/sync-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      setSyncResult({
        success: data.success,
        message: data.message,
        templatesUpdated: data.templatesUpdated
      });
    } catch (error) {
      setSyncResult({
        success: false,
        message: error instanceof Error ? error.message : 'Sync failed'
      });
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={handleSync}
          disabled={isSyncing}
          variant="outline"
          className="flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? 'Syncing...' : 'Sync Creation Engine Templates to DB'}
        </Button>
      </div>
      {syncResult && (
        <p className={`text-sm ${syncResult.success ? 'text-green-600' : 'text-red-600'}`}>
          {syncResult.message}
          {syncResult.templatesUpdated !== undefined && (
            <span className="ml-1">({syncResult.templatesUpdated} templates)</span>
          )}
        </p>
      )}
    </div>
  );
}

export default function AssistantAdvancedTab({
  form,
  selectedAssistant,
  children,
}: AssistantAdvancedTabProps) {
  const [availableContentTypes, setAvailableContentTypes] = useState<IDynamicContent[]>([]);
  
  useEffect(() => {
    const fetchContentTypeDefinitions = async () => {
      const response = await fetch('/api/dynamicContent');
      if (response.ok) {
        const data = await response.json();
        setAvailableContentTypes(data.definitions || []);
      } else {
        setAvailableContentTypes([]);
      }
    };
    fetchContentTypeDefinitions();
  }, [selectedAssistant.tenantId]);

  return (
    <div className="bg-background text-foreground w-full space-y-8 p-6">
      <div className="w-full space-y-6">
        <FormField
            control={form.control}
            name='startFullScreen'
            render={({ field }) => (
              <FormItem className='flex flex-row items-center justify-between'>
                <div className='space-y-0.5'>
                  <FormLabel className='text-base'>Start Full Screen</FormLabel>
                  <FormDescription>
                    Transition to full-screen browser mode when the assistant button is clicked.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch
                    checked={!!field.value}
                    onCheckedChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Access / Features</h2>
            <p className="text-muted-foreground text-sm">
              Control who can access this assistant and which features are enabled.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
          <FormField
            control={form.control}
            name="supportedFeatures"
            render={({ field }) => {
              const titleFor = (key: FeatureKey) =>
                LOGIN_FEATURE_METADATA[key as LoginFeatureKey]?.label ??
                key.replace(/([A-Z])/g, ' $1').replace(/^./, char => char.toUpperCase());

              // Compute keys first so we can default UI to all features when the value is missing
              const keys = [...FeatureKeys].sort((a, b) => {
                const labelComparison = titleFor(a as FeatureKey).localeCompare(
                  titleFor(b as FeatureKey)
                );
                return labelComparison === 0 ? a.localeCompare(b) : labelComparison;
              });
              const selected: string[] = Array.isArray(field.value) ? field.value : keys;
              const ensureUnique = (list: string[]) => Array.from(new Set(list));
              const orderMap = new Map(keys.map((key, index) => [key, index] as const));
              const sortByOrder = (list: string[]) =>
                ensureUnique(list).sort((a, b) => {
                  const aIndex = orderMap.get(a as FeatureKey) ?? Number.MAX_SAFE_INTEGER;
                  const bIndex = orderMap.get(b as FeatureKey) ?? Number.MAX_SAFE_INTEGER;
                  return aIndex - bIndex;
                });
              const selectedSet = new Set(selected);

              const toggle = (key: FeatureKey) => {
                const nextSet = new Set(selectedSet);
                if (nextSet.has(key)) {
                  nextSet.delete(key);
                } else {
                  nextSet.add(key);
                }
                const nextOrdered = sortByOrder(Array.from(nextSet));
                field.onChange(nextOrdered);
              };

              const descriptionFor = (key: FeatureKey) =>
                LOGIN_FEATURE_METADATA[key as LoginFeatureKey]?.description ??
                featureRegistry[key]?.description ??
                '';

              return (
                <FormItem className="">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Enabled Features</FormLabel>
                    <FormDescription>
                      Select which features this assistant supports. Unchecked features are disabled
                      at runtime.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <div className="columns-1 gap-x-6 sm:columns-2 lg:columns-3">
                      {keys.map(key => {
                        const typedKey = key as FeatureKey;
                        const label = titleFor(typedKey);
                        const description = descriptionFor(typedKey);
                        return (
                          <label
                            key={key}
                            className={`hover:border-border/60 hover:bg-muted/30 mb-2 flex w-full break-inside-avoid items-start gap-2 rounded-md border border-transparent p-2 transition}`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={selectedSet.has(typedKey)}
                              onChange={() => toggle(typedKey)}
                            />
                            <span className="flex flex-1 flex-col">
                              <span className="text-sm font-medium leading-none">{label}</span>
                              {description ? (
                                <span className="text-muted-foreground text-xs leading-snug">
                                  {description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          {/* Default Desktop Mode (Home/Work/Creative/Quiet available; others disabled as coming soon) */}
          <FormField
            control={form.control}
            name="desktopMode"
            render={({ field }) => {
              const value: string = field.value || 'home';
              const modes: Array<{
                key: string;
                label: string;
                disabled?: boolean;
                hint?: string;
              }> = [
                { key: 'home', label: 'Home' },
                { key: 'work', label: 'Work' },
                { key: 'creative', label: 'Create' },
                { key: 'quiet', label: 'Quiet' },
                { key: 'gaming', label: 'Gaming', disabled: true, hint: 'Future' },
                { key: 'focus', label: 'Focus', disabled: true, hint: 'Future' },
                { key: 'relaxation', label: 'Relaxation', disabled: true, hint: 'Future' },
              ];
              return (
                <FormItem className="">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Default Desktop Mode</FormLabel>
                    <FormDescription>
                      Controls the initial Interface desktop background for this assistant.
                    </FormDescription>
                  </div>
                  <FormControl>
                    {/* Match the Enabled Features layout and spacing */}
                    <div className="columns-1 gap-x-6 sm:columns-2 lg:columns-3">
                      {modes.map(m => (
                        <label
                          key={m.key}
                          className={`inline-flex w-full break-inside-avoid items-center space-x-2 py-1 ${m.disabled ? 'cursor-not-allowed opacity-60' : ''}`}
                        >
                          <input
                            type="radio"
                            name="desktopMode"
                            value={m.key}
                            className="h-4 w-4"
                            checked={value === m.key}
                            onChange={() => !m.disabled && field.onChange(m.key)}
                            disabled={m.disabled}
                          />
                          <span className="text-sm">{m.label}</span>
                          {m.hint && (
                            <span className="text-muted-foreground text-xs">({m.hint})</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        </div>

        {/* Creation Engine Templates Section */}
        <div className="w-full space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Creation Engine Templates</h2>
              <p className="text-muted-foreground text-sm">
                Sync the built-in library templates (polls, games, etc.) to the database.
                This updates or creates the template applets and configures sharing.
              </p>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg border p-6">
            <SyncTemplatesButton />
          </div>
        </div>

        {/* Legacy Prompt Section */}
        <div className="w-full space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Legacy Prompt (Deprecated)</h2>
              <p className="text-muted-foreground text-sm">
                This prompt is shown for legacy purposes only. All functional prompts are now
                hardwired, and personality prompts are authored in the Admin panel&apos;s
                Personalities page.
              </p>
            </div>
          </div>

          <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
            <FormField
              control={form.control}
              name="model.systemPrompt"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <div className="relative">
                      <Textarea
                        rows={field.value ? 10 : 1}
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder="Leave this blank if already empty..."
                        className="resize-y pr-16"
                      />
                      <div className="absolute right-2 top-2 flex gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center rounded p-1"
                                onClick={async () => {
                                  try {
                                    await navigator.clipboard.writeText(String(field.value || ''));
                                  } catch {
                                    // noop
                                  }
                                }}
                                aria-label="Copy to clipboard"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Copy to clipboard</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex items-center rounded p-1"
                                onClick={() => field.onChange('')}
                                aria-label="Clear"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Clear</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </div>
                  </FormControl>
                  {field.value && String(field.value).trim().length > 0 ? (
                    <p className="mt-2 text-sm text-red-600">
                      Please move this prompt content to a personality record
                    </p>
                  ) : null}
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Privacy Configuration</h2>
            <p className="text-muted-foreground text-sm">
              Configure privacy and recording settings for your assistant. These settings will
              affect how your assistant handles sensitive information and recordings. HIPAA
              compliance is a requirement for healthcare providers.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
          <FormField
            control={form.control}
            name="hipaaEnabled"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center justify-between">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">HIPAA Compliance</FormLabel>
                  <FormDescription>
                    When this is enabled, no logs, recordings, or transcriptions will be stored.
                  </FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Messaging</h2>
            <p className="text-muted-foreground text-sm">
              Message configuration for messages that are sent to and from the assistant.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
          <FormField
            control={form.control}
            name="clientMessages"
            render={({ field }) => (
              <FormItem className="">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Client Messages</FormLabel>
                  <FormDescription>
                    These are the messages that will be sent to the Client SDKs.
                  </FormDescription>
                </div>
                <FormControl>
                  <FancyMultiSelect
                    options={clientMessagesOptions}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="serverMessages"
            render={({ field }) => (
              <FormItem className="">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Server Messages</FormLabel>
                  <FormDescription>
                    These are the messages that will be sent to the Server URL configured.
                  </FormDescription>
                </div>
                <FormControl>
                  <FancyMultiSelect
                    options={serverMessagesOptions}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="endCallMessage"
            render={({ field }) => (
              <FormItem className="">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">End Call Message</FormLabel>
                  <FormDescription>
                    This is the message that the assistant will say if the call is ended.
                  </FormDescription>
                </div>
                <FormControl>
                  <Input value={field.value} onChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Phone Messaging</h2>
            <p className="text-muted-foreground text-sm">
              Configure phone number settings for your assistant.
            </p>
          </div>
        </div>

        <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
          <FormField
            control={form.control}
            name="assistantPhoneNumber"
            render={({ field }) => (
              <FormItem className="">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Assistant Phone Number</FormLabel>
                  <FormDescription>
                    The phone number that will be associated with your assistant for phone-based
                    interactions.
                  </FormDescription>
                </div>
                <FormControl>
                  <Input value={field.value} onChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {/* Content Types Field */}
        <div className="bg-muted/50 space-y-6 rounded-lg border p-6">
          <FormField
            control={form.control}
            name="contentTypes"
            render={({ field }) => (
              <FormItem className="">
                <div className="space-y-0.5">
                  <FormLabel className="text-base">Supported Content Types</FormLabel>
                  <FormDescription>
                    This is the list of content types this assistant supports. You can add or remove
                    types as needed.
                  </FormDescription>
                </div>
                <FormControl>
                  <FancyMultiSelect
                    options={availableContentTypes.map(def => ({
                      label: def.name,
                      value: def.name,
                    }))}
                    value={field.value || []}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
      {children}
    </div>
  );
}
