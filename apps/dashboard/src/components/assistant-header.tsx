'use client';

// Define a minimal IAssistant type for client use
interface IAssistant {
  _id?: string;
  name: string;
  subDomain?: string;
  createdAt?: string;
  // Add other fields as needed
}

import { AlertTriangle, Copy, Ellipsis, Loader2, Trash2 } from 'lucide-react';
import { ThemeToggle } from './theme-toggle';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Switch } from './ui/switch';
// import { AssistantBlock } from "@nia/prism/core/blocks";
// import { AssistantActions } from '@nia/prism/core/actions';
import { useToast } from '@dashboard/hooks/use-toast';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from './ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

export const AssistantHeader = ({ assistant }: { assistant: IAssistant }) => {
  const { toast } = useToast();
  const router = useRouter();
  const [isCloneDialogOpen, setIsCloneDialogOpen] = useState(false);
  const [clonedAssistantName, setClonedAssistantName] = useState('');
  const [isCloning, setIsCloning] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');

  const handleCloneAssistant = async () => {
    if (!clonedAssistantName.trim()) {
      toast({
        title: 'Error',
        description: 'New assistant name cannot be empty.',
        variant: 'destructive',
      });
      return;
    }
    setIsCloning(true);
    try {
      const response = await fetch(`/api/assistant/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant._id, newName: clonedAssistantName }),
      });
      if (response.ok) {
        toast({
          title: 'Success',
          description: `Assistant \"${clonedAssistantName}\" cloned successfully.`,
        });
        setIsCloneDialogOpen(false);
        setClonedAssistantName('');
        router.refresh();
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to clone assistant.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description:
          (error instanceof Error && error.message) ||
          'An error occurred while cloning the assistant.',
        variant: 'destructive',
      });
    } finally {
      setIsCloning(false);
    }
  };

  const handleDeleteAssistant = async () => {
    if (deleteConfirmationName.trim() !== assistant.name) {
      toast({
        title: 'Error',
        description: 'Name does not match assistant name',
        variant: 'destructive',
      });
      return;
    }
    try {
      const response = await fetch(`/api/assistant/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantId: assistant._id }),
      });
      if (response.ok) {
        toast({
          title: `Assistant ${assistant.name} deleted successfully`,
          description: 'The assistant has been deleted.',
        });
        router.push('/dashboard/assistants');
      } else {
        const data = await response.json();
        toast({
          title: 'Error',
          description: data?.error || 'Failed to delete assistant.',
          variant: 'destructive',
        });
      }
    } catch (error) {
      toast({
        title: 'Error',
        description:
          (error instanceof Error && error.message) ||
          'An error occurred while deleting the assistant.',
        variant: 'destructive',
      });
    } finally {
      setIsDeleteDialogOpen(false);
      setDeleteConfirmationName('');
    }
  };

  // Use localhost for local development, otherwise try configured URLs
  const isLocalDev = typeof window !== 'undefined' && 
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const fallbackBaseUrl = isLocalDev ? 'http://localhost:3000' : 'https://interface.stg.nxops.net';
  const derivedBaseUrl = process.env.NEXT_PUBLIC_API_URL?.replace('dashboard', 'interface');
  const configuredBaseUrl =
    process.env.NEXT_PUBLIC_INTERFACE_BASE_URL || process.env.INTERFACE_BASE_URL;
  let assistantBaseUrl = configuredBaseUrl;

  if (!configuredBaseUrl) {
    if (isLocalDev) {
      // In local dev, use localhost:3000 directly
      assistantBaseUrl = 'http://localhost:3000';
    } else if (!derivedBaseUrl) {
      console.warn(`Could not derive interface base URL, using hardcoded fallback`);
      assistantBaseUrl = fallbackBaseUrl;
    } else {
      console.warn(`No configured interface base URL found, using URL derived from API`);
      assistantBaseUrl = derivedBaseUrl;
    }
  }

  const handleCopyUrl = async () => {
    const url = `${assistantBaseUrl}/${assistant.subDomain}`;
    await navigator.clipboard.writeText(url);
    toast({
      title: 'URL Copied',
      description: 'Assistant URL copied to clipboard',
    });
  };

  const handleCopyAssistantId = async () => {
    if (!assistant._id) {
      toast({
        title: 'Unavailable',
        description: 'Assistant ID is not available to copy',
        variant: 'destructive',
      });
      return;
    }
    await navigator.clipboard.writeText(assistant._id);
    toast({
      title: 'Assistant ID Copied',
      description: 'Assistant ID copied to clipboard',
    });
  };

  return (
    <header className="flex h-16 items-center gap-2 justify-between px-4">
      <div className="flex items-center gap-2 text-sm">
        <Link
          href={`${assistantBaseUrl}/${assistant.subDomain}`}
          target="_blank"
          className="text-sm transition-colors duration-200 flex items-center gap-2"
        >
          <p className="font-semibold bg-gradient-to-r from-[#0097B2] to-[#003E49] bg-clip-text text-transparent hover:from-[#008299] hover:to-[#00313A]">
            {assistantBaseUrl}/{assistant.subDomain}
          </p>
        </Link>
        <Button aria-label="Copy assistant URL" variant="ghost" size="icon" onClick={handleCopyUrl}>
          <Copy className="h-4 w-4" />
        </Button>
        {assistant._id ? (
          <Badge
            role="button"
            onClick={handleCopyAssistantId}
            title="Click to copy Assistant ID"
            className="font-mono cursor-pointer select-none"
            variant="secondary"
          >
            ID: {assistant._id.length > 16
              ? `${assistant._id.slice(0, 8)}…${assistant._id.slice(-6)}`
              : assistant._id}
          </Badge>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <Dialog
          open={isCloneDialogOpen}
          onOpenChange={isOpen => {
            setIsCloneDialogOpen(isOpen);
            if (!isOpen) {
              setClonedAssistantName('');
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white">
              <div className="flex items-center gap-2">
                <span>Clone Assistant</span>
                <Copy className="h-4 w-4" />
              </div>
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Clone Assistant</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p>Enter a new name for the cloned assistant.</p>
              <Input
                value={clonedAssistantName}
                onChange={e => setClonedAssistantName(e.target.value)}
                placeholder="New assistant name"
              />
              <Button onClick={handleCloneAssistant} disabled={isCloning}>
                {isCloning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Cloning...
                  </>
                ) : (
                  'Clone'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Ellipsis className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setIsDeleteDialogOpen(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Assistant: {assistant.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <div className="mt-4 space-y-2">
                <p className="text-foreground font-medium">Assistant Details:</p>
                <div className="p-3 bg-destructive/10 rounded-md">
                  <p className="text-sm">
                    <span className="font-semibold">Assistant Name:</span> {assistant.name}
                  </p>
                  <p className="text-sm mt-1">
                    <span className="font-semibold">Created On:</span>{' '}
                    {assistant.createdAt
                      ? new Date(assistant.createdAt).toLocaleDateString()
                      : 'Unknown'}
                  </p>
                </div>
                <p className="text-destructive font-medium mt-4">
                  This action cannot be undone. Type the assistant name to confirm deletion.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            placeholder={`Type "${assistant.name}" to confirm`}
            value={deleteConfirmationName}
            onChange={e => setDeleteConfirmationName(e.target.value)}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAssistant}
              disabled={deleteConfirmationName.trim() !== assistant.name}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </header>
  );
};
