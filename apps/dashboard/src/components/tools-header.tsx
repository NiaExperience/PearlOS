'use client';

import { SidebarTrigger } from './ui/sidebar';
import { Separator } from './ui/separator';
import { ThemeToggle } from './theme-toggle';
// import { ToolBlock } from '@nia/prism/core/blocks';
import { CopyIcon, Trash2, Check as CheckIcon } from 'lucide-react';
import { Button } from './ui/button';
// import { ToolsActions } from '@nia/prism/core/actions';
import { useToast } from '../hooks/use-toast';
import { useState } from 'react';

// Define a minimal ITool type for client use
interface ITool {
  _id?: string;
  function?: {
    name?: string;
    description?: string;
  };
}

export function ToolsHeader({ selectedTool }: { selectedTool: ITool }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleDeleteTool = async () => {
    try {
      const response = await fetch('/api/tools/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: selectedTool._id }),
      });
      if (response.ok) {
        const data = await response.json();
        toast({
          title: `Tool ${data?.tool?.function?.name} deleted successfully`,
          description: 'The tool has been deleted.',
        });
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to delete tool.',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'An unexpected error occurred while deleting the tool.',
        variant: 'destructive',
      });
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(selectedTool?._id ?? '');
    toast({
      title: 'Copied to clipboard',
      description: 'The tool ID has been copied to your clipboard.',
    });
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 3000);
  };

  return (
    <header className='gap-2 p-4 border-b'>
      <div className='flex items-center justify-between w-full'>
        <div className='flex items-center'>
          <SidebarTrigger className='-ml-1' />
          <Separator orientation='vertical' className='mr-2 h-4' />
          <div className='flex items-center gap-2 flex-end'>
            <h1>{selectedTool?.function?.name ?? 'Tools'}</h1>
          </div>
        </div>
        <div className='flex items-center gap-2'>
          <ThemeToggle />
          <Button onClick={handleDeleteTool} variant='outline' size='icon'>
            <Trash2 className='size-4' />
          </Button>
        </div>
      </div>

      <div className='flex flex-col justify-start items-start gap-2 mt-4'>
        <div className='flex items-center rounded-md w-full justify-between'>
          <div className='flex items-center gap-2 border border-gray-200 px-3 rounded-md'>
            <p className='text-sm text-gray-500 px-2 p-2'>
              {selectedTool?._id}
            </p>
            <Button
              variant='ghost'
              disabled={copied}
              className='size-3 p-2'
              onClick={handleCopyId}
            >
              {copied ? (
                <CheckIcon className='size-2 text-green-500 animate-pulse' />
              ) : (
                <CopyIcon className='size-2' />
              )}
            </Button>
          </div>
        </div>
        <p className='text-sm text-gray-500'>
          {selectedTool?.function?.description}
        </p>
      </div>
    </header>
  );
}
