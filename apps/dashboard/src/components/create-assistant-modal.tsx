'use client';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';
import { Bot, Copy, FileText, Sparkles, FilePlus } from 'lucide-react';
import {
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { AssistantActions } from '@nia/prism/core/actions';
import { useEffect, useState } from 'react';
import { useForm, SubmitErrorHandler } from 'react-hook-form';
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
import { useToast } from '../hooks/use-toast';
import { useRouter } from 'next/navigation';
import { IAssistant, AssistantSchema } from '@nia/prism/core/blocks/assistant.block';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Textarea } from './ui/textarea';
// Use the server version of getSessionSafely for server-side logic
import { getSessionSafely } from '@nia/prism/core/auth';
import { TenantActions } from '@nia/prism/core/actions';

type ModalView = 'initial' | 'select_template' | 'configure_template' | 'create_scratch';

export default function CreateAssistantModal() {
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingTemplates, setIsFetchingTemplates] = useState(false);
  const [modalView, setModalView] = useState<ModalView>('initial');
  const [availableTemplates, setAvailableTemplates] = useState<IAssistant[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<IAssistant | null>(null);

  const { toast } = useToast();
  const router = useRouter();

  // Specifically make tenantId optional using .extend()
  // We'll fill it in later based on the user's session
  const formSchema = AssistantSchema.extend({
    tenantId: AssistantSchema.shape.tenantId.optional(),
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      special_instructions: '',
    },
  });

  useEffect(() => {
    if (modalView === 'select_template') {
      const fetchTemplates = async () => {
        setIsFetchingTemplates(true);
        try {
          // TODO: feed it the chosen tenantId from the session
          const res = await fetch('/api/assistant');
          if (!res.ok) throw new Error('Failed to fetch templates');
          const data = await res.json();
          if (data.templates) {
            setAvailableTemplates(data.templates);
          } else {
            setAvailableTemplates([]);
            toast({
              title: 'No templates found',
              description: 'You can create assistants from scratch.',
              variant: 'default',
            });
          }
        } catch (error) {
          console.error('Failed to fetch templates:', error);
          toast({
            title: 'Failed to load templates',
            variant: 'destructive',
          });
        } finally {
          setIsFetchingTemplates(false);
        }
      };
      fetchTemplates();
    }
  }, [modalView, toast]);

  const handleCreateFromScratchSubmit = async (values: z.infer<typeof formSchema>) => {
    setIsLoading(true);
    try {
      // TODO: feed it the chosen tenantId from the session
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (res.ok && data.assistant) {
        toast({
          title: 'Assistant created successfully',
          variant: 'default',
        });
        router.push(`/dashboard/assistants/${data.assistant._id}`);
      } else {
        throw new Error(data.error || 'Assistant creation returned no data.');
      }
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to create assistant',
        description: error instanceof Error ? error.message : 'An unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfigureTemplateSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!selectedTemplate) {
      toast({ title: 'No template selected', variant: 'destructive' });
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch('/api/assistant/clone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate._id,
          newName: values.name,
          special_instructions: values.special_instructions,
        }),
      });
      const data = await res.json();
      if (res.ok && data.assistant) {
        toast({
          title: 'Assistant created from template successfully',
          variant: 'default',
        });
        router.push(`/dashboard/assistants/${data.assistant._id}`);
      } else {
        throw new Error(data.error || 'Cloning assistant returned no data.');
      }
    } catch (error) {
      console.error(error);
      toast({
        title: 'Failed to create from template',
        description: error instanceof Error ? error.message : 'An unknown error occurred',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const onError: SubmitErrorHandler<z.infer<typeof formSchema>> = (errors) => {
    console.log('Form errors:', errors);
    // Optionally, display a generic form error toast or iterate through errors
    // Example: for (const key in errors) { toast({ title: `Error in ${key}`, description: errors[key]?.message, variant: 'destructive'})}
  };
  
  const resetFormAndState = () => {
    form.reset({ 
      name: '', 
      special_instructions: '',
    });
    setSelectedTemplate(null);
  };

  const renderModalContent = () => {
    switch (modalView) {
      case 'initial':
        return (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2 text-xl font-bold'>
                <Bot className='size-7' /> Create New Assistant
              </DialogTitle>
              <DialogDescription>
                How would you like to start?
              </DialogDescription>
            </DialogHeader>
            <div className='grid grid-cols-1 md:grid-cols-2 gap-4 py-6'>
              <Button variant="outline" className="h-28 text-lg flex flex-col items-center justify-center gap-2 p-4" onClick={() => setModalView('select_template')}>
                <Sparkles className="size-7 text-primary" />
                <span>From Template</span>
              </Button>
              <Button variant="outline" className="h-28 text-lg flex flex-col items-center justify-center gap-2 p-4" onClick={() => {
                form.reset({ name: '' });
                setModalView('create_scratch');
              }}>
                <FilePlus className="mr-2 size-7 text-primary" />
                <span>From Scratch</span>
              </Button>
            </div>
          </>
        );

      case 'select_template':
        return (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2 text-xl font-bold'>
                <Sparkles className='size-7' /> Select a Template
              </DialogTitle>
              <DialogDescription>
                Choose a pre-configured assistant to get started quickly.
              </DialogDescription>
            </DialogHeader>
            {isFetchingTemplates ? (
              <div className="flex justify-center items-center h-40"><p>Loading templates...</p></div>
            ) : availableTemplates.length > 0 ? (
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 py-4 max-h-[400px] overflow-y-auto pr-2'>
                {availableTemplates.map((template) => (
                  <Card
                    key={template._id}
                    className='cursor-pointer hover:shadow-lg transition-shadow flex flex-col'
                    onClick={() => {
                      setSelectedTemplate(template);
                      form.reset({ name: `${template.template_display_name || template.name} Copy` });
                      setModalView('configure_template');
                    }}
                  >
                    <CardHeader className="flex-shrink-0">
                      <div className="flex items-start gap-3">
                        {template.template_icon_url ? (
                          <img src={template.template_icon_url} alt={template.template_display_name || template.name} className="size-10 object-contain rounded-md border p-1" />
                        ) : (
                          <div className="flex items-center justify-center size-10 rounded-md border bg-muted">
                            <Bot className="size-6 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-grow">
                          <CardTitle className="text-base leading-tight">{template.template_display_name || template.name}</CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {template.template_category ? `Category: ${template.template_category}` : 'General'}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground line-clamp-3 flex-grow">
                      {template.template_description || 'No description available.'}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <p>No templates available. You can create one or start from scratch.</p>
            )}
            <DialogFooter className="pt-4">
              <Button variant="outline" onClick={() => setModalView('initial')}>Back</Button>
            </DialogFooter>
          </>
        );

      case 'configure_template':
      case 'create_scratch':
        const isConfiguringTemplate = modalView === 'configure_template';
        return (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2 text-xl font-bold'>
                {isConfiguringTemplate ? <Copy className='size-7' /> : <FileText className='size-7' />}
                {isConfiguringTemplate ? `Configure '${selectedTemplate?.template_display_name || selectedTemplate?.name}'` : 'Create New Assistant'}
              </DialogTitle>
              <DialogDescription>
                {isConfiguringTemplate
                  ? `Provide a new name and details for your assistant based on the '${selectedTemplate?.template_display_name || selectedTemplate?.name}' template.`
                  : 'Define the details for your new assistant.'}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(
                isConfiguringTemplate ? handleConfigureTemplateSubmit : handleCreateFromScratchSubmit,
                onError
              )} className="space-y-4">
                <FormField
                  control={form.control}
                  name='name'
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        New Assistant Name
                        <span className='text-muted-foreground text-xs'> (Required)</span>
                      </FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., My Awesome AI Bot" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {/* Special Instructions Input */}
                <FormField
                  control={form.control}
                  name="special_instructions" 
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>
                        Special Instructions
                        <span className='text-muted-foreground text-xs'> (Optional - Specific guidelines for the AI)</span>
                      </FormLabel>
                      <FormControl>
                        <Textarea 
                          {...field} 
                          value={field.value || ''}
                          placeholder="e.g., Be very brief. Focus on solutions. Always ask clarifying questions if the user's query is ambiguous." 
                          rows={3}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter className="pt-6">
                   <Button variant="outline" onClick={() => setModalView(isConfiguringTemplate ? 'select_template' : 'initial')}>
                    Back
                  </Button>
                  <Button type='submit' disabled={isLoading}>
                    {isLoading ? 'Creating...' : (isConfiguringTemplate ? 'Create from Template' : 'Create Assistant')}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </>
        );
      default:
        return <p>Something went wrong.</p>;
    }
  };

  return (
    <DialogContent onInteractOutside={(e) => {
        if (isLoading || isFetchingTemplates) {
            e.preventDefault();
        }
    }}
    onEscapeKeyDown={(e) => {
        if (isLoading || isFetchingTemplates) {
            e.preventDefault();
        }
    }}
    className="max-w-md md:max-w-lg lg:max-w-2xl"
    >
        {renderModalContent()}
    </DialogContent>
  );
}
