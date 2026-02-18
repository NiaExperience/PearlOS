import {
  Form,
  FormItem,
  FormField,
  FormLabel,
  FormControl,
  FormDescription,
} from './ui/form';
import { Input } from './ui/input';
import { useToast } from '../hooks/use-toast';
import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { ToolBlock } from '@nia/prism/core/blocks';
// import { ToolsActions } from '@nia/prism/core/actions';
import { z } from 'zod';
import { Textarea } from './ui/textarea';
import { Switch } from './ui/switch';
import { Button } from './ui/button';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useParams, useSearchParams } from 'next/navigation';

export function ToolsContent({ selectedTool }: { selectedTool: ToolBlock.ITool }) {
  const [isLoading, setIsLoading] = useState(false);
  const params = useSearchParams();
  const toolId = params.get('toolId');
  // Platform types can use 'any' as the tenantId.
  const tenantId: string = 'any';
  const form = useForm<z.infer<typeof ToolBlock.ToolSchema>>({
    resolver: zodResolver(ToolBlock.ToolSchema),
  });

  useEffect(() => {
    form.reset(selectedTool as unknown as z.infer<typeof ToolBlock.ToolSchema>);
  }, [selectedTool]);

  const { toast } = useToast();

  async function onSubmit(values: z.infer<typeof ToolBlock.ToolSchema>) {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/contentDetail/${selectedTool._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (response.ok) {
        toast({
          title: `Tool ${values.function?.name} updated successfully`,
          description: 'The tool has been updated.',
        });
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to update tool.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to update tool.',
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function onError(errors: any) {
    console.log(errors);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit, onError)}
        className='space-y-6 m-6'
      >
        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold'>Tool Details</h2>
            <p className='text-sm max-w-2xl text-muted-foreground'></p>
          </div>
          <Button type='submit' disabled={isLoading}>
            {isLoading ? (
              <Loader2 className='h-4 w-4 mr-2 animate-spin' />
            ) : (
              <Save className='h-4 w-4 mr-2' />
            )}
            Save
          </Button>
        </div>

        <div className='space-y-6 border p-6 rounded-lg bg-muted/50'>
          <FormField
            control={form.control}
            name='function.name'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tool Name</FormLabel>
                <FormControl>
                  <Input placeholder='Enter tool name' {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='function.description'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Tool Description</FormLabel>
                <FormControl>
                  <Textarea placeholder='Enter tool description' {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='async'
            render={({ field }) => (
              <FormItem className='flex flex-col border p-4 rounded-lg bg-muted/50'>
                <div className='flex items-center justify-between'>
                  <div className='space-y-0.5'>
                    <FormLabel>Async Tool boolean async</FormLabel>
                    <FormDescription className='text-sm text-gray-400'>
                      This setting defines whether the assistant will move
                      forward or wait for your server to respond. Enable this if
                      you just want to trigger something on your server.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </div>
              </FormItem>
            )}
          />

          <div>
            <h2 className='text-lg font-semibold'>Parameters</h2>
            <p className='text-sm max-w-2xl text-muted-foreground'>
              Parameters are the input arguments for the tool. They are used to
              pass data to the tool.
            </p>

            <div>
              <FormField
                control={form.control}
                name='function.parameters.properties'
                render={({ field }) => (
                  <FormItem>
                    <div className='space-y-4 mt-4'>
                      {Object.entries(field.value || {}).map(
                        ([key, value], index) => (
                          <div key={index} className='flex gap-4'>
                            <FormItem className='flex-1'>
                              <FormControl>
                                <Input
                                  placeholder='Parameter Name'
                                  value={key}
                                  onChange={(e) => {
                                    const newParams = { ...field.value };
                                    delete newParams[key];
                                    newParams[e.target.value] = value;
                                    field.onChange(newParams);
                                  }}
                                />
                              </FormControl>
                            </FormItem>
                            <FormItem className='flex-1'>
                              <FormControl>
                                <Input
                                  placeholder='Parameter Type'
                                  value={value.type}
                                  onChange={(e) => {
                                    const newParams = { ...field.value };
                                    newParams[key] = {
                                      ...value,
                                      type: e.target.value,
                                    };
                                    field.onChange(newParams);
                                  }}
                                />
                              </FormControl>
                            </FormItem>
                            <FormItem className='flex-1'>
                              <FormControl>
                                <Input
                                  placeholder='Parameter Description'
                                  value={value.description}
                                  onChange={(e) => {
                                    const newParams = { ...field.value };
                                    newParams[key] = {
                                      ...value,
                                      description: e.target.value,
                                    };
                                    field.onChange(newParams);
                                  }}
                                />
                              </FormControl>
                            </FormItem>
                            <Button
                              type='button'
                              variant='destructive'
                              size='icon'
                              onClick={() => {
                                const newParams = { ...field.value };
                                delete newParams[key];
                                field.onChange(newParams);
                              }}
                            >
                              <Trash2 className='h-4 w-4' />
                            </Button>
                          </div>
                        )
                      )}
                      <Button
                        type='button'
                        variant='outline'
                        onClick={() => {
                          const newParams = { ...field.value };
                          const maxNumber = Math.max(
                            0,
                            ...Object.keys(field.value || {}).map((key) => {
                              const match = key.match(/param(\d+)/);
                              return match ? parseInt(match[1]) : 0;
                            })
                          );
                          newParams[`param${maxNumber + 1}`] = {
                            type: '',
                            description: '',
                          };
                          field.onChange(newParams);
                        }}
                        className='mt-2'
                      >
                        <Plus className='h-4 w-4 mr-2' />
                        Add Parameter
                      </Button>
                    </div>
                  </FormItem>
                )}
              />
            </div>
          </div>
        </div>

        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold'>Integrations</h2>
            <p className='text-sm max-w-2xl text-muted-foreground'></p>
          </div>
        </div>

        <div className='space-y-6 border p-6 rounded-lg bg-muted/50'>
          <FormField
            control={form.control}
            name='server.url'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Server URL</FormLabel>
                <FormControl>
                  <Input
                    placeholder='Enter server URL for your custom POST endpoint'
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='server.timeoutSeconds'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timeout</FormLabel>
                <FormControl>
                  <Input
                    placeholder='Enter timeout in seconds'
                    {...field}
                    type='number'
                    min={1}
                    max={120}
                  />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  This is the timeout in seconds for the request to your server.
                  Must be between 1 and 120 seconds.
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='server.secret'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Secret</FormLabel>
                <FormControl>
                  <Input
                    placeholder='Enter secret for your custom POST endpoint'
                    {...field}
                  />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  This is the secret for your custom POST endpoint.
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='server.headers'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Headers</FormLabel>
                <FormDescription className='text-sm text-gray-400'>
                  Add custom headers for your server requests
                </FormDescription>
                <div className='space-y-4'>
                  {Object.entries(field.value || {}).map(
                    ([key, value], index) => (
                      <div key={index} className='flex gap-4'>
                        <FormField
                          control={form.control}
                          name={`server.headers.${key}`}
                          render={({ field: headerField }) => (
                            <div className='flex gap-4 w-full'>
                              <FormItem className='flex-1'>
                                <FormControl>
                                  <Input
                                    placeholder='Header Key'
                                    value={key}
                                    onChange={(e) => {
                                      const newHeaders = { ...field.value };
                                      delete newHeaders[key];
                                      newHeaders[e.target.value] = value;
                                      field.onChange(newHeaders);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                              <FormItem className='flex-1'>
                                <FormControl>
                                  <Input
                                    placeholder='Header Value'
                                    value={value}
                                    onChange={(e) => {
                                      const newHeaders = { ...field.value };
                                      newHeaders[key] = e.target.value;
                                      field.onChange(newHeaders);
                                    }}
                                  />
                                </FormControl>
                              </FormItem>
                              <Button
                                type='button'
                                variant='destructive'
                                size='icon'
                                onClick={() => {
                                  const newHeaders = { ...field.value };
                                  delete newHeaders[key];
                                  field.onChange(newHeaders);
                                }}
                              >
                                <Trash2 className='h-4 w-4' />
                              </Button>
                            </div>
                          )}
                        />
                      </div>
                    )
                  )}
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => {
                      const newHeaders = { ...field.value };
                      // Find the highest number in existing header keys
                      const existingNumbers = Object.keys(
                        field.value || {}
                      ).map((key) => {
                        const match = key.match(/header(\d+)/);
                        return match ? parseInt(match[1]) : 0;
                      });
                      const maxNumber = Math.max(0, ...existingNumbers);
                      // Use the next number for the new header
                      newHeaders[`header${maxNumber + 1}`] = '';
                      field.onChange(newHeaders);
                    }}
                    className='mt-2'
                  >
                    <Plus className='h-4 w-4 mr-2' />
                    Add Header
                  </Button>
                </div>
              </FormItem>
            )}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div>
            <h2 className='text-lg font-semibold'>Tools Messages</h2>
            <p className='text-sm max-w-2xl text-muted-foreground'></p>
          </div>
        </div>

        <div className='space-y-6 border p-6 rounded-lg bg-muted/50'>
          <FormField
            control={form.control}
            name='requestMessages.start.content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Request Start Message</FormLabel>
                <FormControl>
                  <Input placeholder='Enter message' {...field} value={field.value ?? ''} />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  Message shown when the tool starts executing. This message is
                  never triggered for async tools. If not provided, a default
                  message like "Hold on a sec" will be used.
                </FormDescription>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name='requestMessages.delayed.content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Request Delayed Message</FormLabel>
                <FormControl>
                  <Input placeholder='Enter message' {...field} value={field.value ?? ''} />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  Message shown when the tool execution is taking longer than
                  expected or when the user talks while processing. This message
                  is never triggered for async tools.
                </FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='requestMessages.completed.content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Request Completed Message</FormLabel>
                <FormControl>
                  <Input placeholder='Enter message' {...field} value={field.value ?? ''} />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  Message shown when the tool completes successfully. For async
                  tools, this is triggered immediately without waiting for
                  server response. If not provided, the model will generate a
                  response.
                </FormDescription>
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name='requestMessages.failed.content'
            render={({ field }) => (
              <FormItem>
                <FormLabel>Request Failed Message</FormLabel>
                <FormControl>
                  <Input placeholder='Enter message' {...field} value={field.value ?? ''} />
                </FormControl>
                <FormDescription className='text-sm text-gray-400'>
                  Message shown when the tool execution fails. This message is
                  never triggered for async tools. If not provided, the model
                  will generate an error response.
                </FormDescription>
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  );
}
