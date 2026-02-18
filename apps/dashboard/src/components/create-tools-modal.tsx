'use client';

import { Bot, Loader2, PencilRuler } from 'lucide-react';
import {
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogDescription,
} from './ui/dialog';
import { useState } from 'react';
import { FieldErrors, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from './ui/form';
import { Input } from './ui/input';
import { z } from 'zod';
import { Button } from './ui/button';
import { AutosizeTextarea } from './ui/autosize-textarea';
// import { ToolsActions } from '@nia/prism/core/actions';
import { useToast } from '../hooks/use-toast';
// import { ToolBlock } from '@nia/prism/core/blocks';

// Define a minimal tool schema for client validation
const ToolSchema = z.object({
  name: z.string().min(1, 'Tool name is required'),
  description: z.string().optional(),
});

type ToolFormValues = z.infer<typeof ToolSchema>;

export default function CreateToolsModal() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<ToolFormValues>({
    resolver: zodResolver(ToolSchema),
  });

  const handleCreateTool = async (values: ToolFormValues) => {
    try {
      setIsLoading(true);

      if (!values.name) {
        throw new Error('Tool name is required');
      }

      // Call the API route to create the tool
      const response = await fetch('/api/tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          description: values.description || '',
        }),
      });

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Tool created successfully',
          variant: 'default',
        });
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to create tool',
          variant: 'destructive',
        });
      }

      setIsLoading(false);
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'An unknown error occurred',
        variant: 'destructive',
      });
      console.error(error);
      setIsLoading(false);
    }
  };

  const onError = (errors: FieldErrors<ToolFormValues>) => {
    console.log(errors);
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle className='flex items-center gap-2 text-2xl font-bold'>
          <PencilRuler className='size-8' /> Create Tool
        </DialogTitle>
        <DialogDescription>
          Tools are functions you make that can be utilized by your assistants
          in calls. You can create custom tools for assistants to use.
        </DialogDescription>
      </DialogHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(handleCreateTool, onError)}>
          <div className='space-y-4'>
            <FormField
              control={form.control}
              name='name'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tool Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder='What is your tool name? (e.g. "getUserInfo", "getWeather", "getStockPrice", etc.)'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name='description'
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tool Description</FormLabel>
                  <FormControl>
                    <AutosizeTextarea
                      {...field}
                      placeholder='Describe what your tool does, usage examples, etc.'
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type='submit' disabled={isLoading} className='w-full mt-3'>
              {isLoading ? (
                <Loader2 className='size-4 animate-spin' />
              ) : (
                'Create Tool'
              )}
            </Button>
          </div>
        </form>
      </Form>
    </DialogContent>
  );
}
