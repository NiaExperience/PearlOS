'use client';

import { SidebarProvider } from './ui/sidebar';
import { useState } from 'react';
import { ToolsSidebar } from './tools-sidebar';
import { ITool } from '@nia/prism/core/blocks/tool.block';
import { ToolsHeader } from './tools-header';
import { ToolsContent } from './tools-content';
import EditableImageTable from './editable-image-table';

const ToolsComponent = ({ tools: initialTools }: { tools: ITool[] }) => {
  const [selectedTool, setSelectedTool] = useState<ITool | null>(null);

  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': '350px',
        } as React.CSSProperties
      }
    >
      <ToolsSidebar
        tools={initialTools}
        onSelectTool={setSelectedTool}
        selectedTool={selectedTool}
      />
      {selectedTool && (
        <div className='w-full'>
          <ToolsHeader selectedTool={selectedTool} />
          <ToolsContent selectedTool={selectedTool} />
        </div>
      )}
    </SidebarProvider>
  );
};

export default ToolsComponent;
