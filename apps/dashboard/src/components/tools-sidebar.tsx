'use client';

import * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
} from '@dashboard/components/ui/sidebar';
import { Dialog, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { PlusCircle } from 'lucide-react';
import { ITool } from '@nia/prism/core/blocks/tool.block';
export type { ITool } from '@nia/prism/core/blocks/tool.block';

import CreateToolsModal from './create-tools-modal';
import { useRouter } from 'next/navigation';

export function ToolsSidebar({
  tools,
  onSelectTool,
  selectedTool,
}: {
  tools: ITool[];
  onSelectTool: React.Dispatch<React.SetStateAction<ITool | null>>;
  selectedTool: ITool | null;
}) {
  const router = useRouter();

  const handleSelectTool = (tool: ITool) => {
    onSelectTool(tool);
    router.push(`/dashboard/tools/?toolId=${tool._id}`);
  };

  return (
    <Sidebar className='hidden flex-1 md:flex left-64 z-20'>
      <SidebarHeader className='gap-3.5 border-b p-4'>
        <div className='flex w-full items-center justify-between'>
          <div className='text-base font-medium text-foreground'>
            Tools List
          </div>
          <Dialog>
            <DialogTrigger>
              <Button asChild>
                <div className='flex items-center gap-2'>
                  Create Tool <PlusCircle className='size-4' />
                </div>
              </Button>
            </DialogTrigger>
            <CreateToolsModal />
          </Dialog>
        </div>
        <SidebarInput placeholder='Type to search...' />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className='px-0'>
          <SidebarGroupContent>
            {tools?.map((tool) => (
              <a
                href='#'
                key={tool._id}
                onClick={() => handleSelectTool(tool)}
                className={`flex flex-col items-start gap-2 whitespace-nowrap border-b p-4 text-sm leading-tight last:border-b-0 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${
                  selectedTool?._id === tool._id
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : ''
                }`}
              >
                <div className='flex w-full items-center gap-2'>
                  <span className='line-clamp-1 w-full font-semibold'>
                    {tool?.function?.name}
                  </span>{' '}
                  <span className='ml-auto text-xs'>{tool._id}</span>
                </div>
                <span className='font-medium line-clamp-2 max-w-xs text-xs'>
                  {tool?.function?.description}
                </span>
              </a>
            ))}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
