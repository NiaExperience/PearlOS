'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dashboard/components/ui/card';
import { Input } from '@dashboard/components/ui/input';
import { Button } from '@dashboard/components/ui/button';
import { Badge } from '@dashboard/components/ui/badge';
import { useToast } from '@dashboard/hooks/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dashboard/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@dashboard/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@dashboard/components/ui/form';
import { ToolBlock } from '@nia/prism/core/blocks';
import { Loader2,  Trash2, Pencil } from 'lucide-react';
import { ImageUrl } from '../types/assistant-content/photo';
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card';
import { FieldErrors } from 'react-hook-form';

// Update the form schema
const urlFormSchema = z.object({
  url: z.string().url({ message: 'Please enter a valid URL' }),
  album: z.string().min(1, { message: 'Album is required' }),
});

export default function EditableImageTable({
  tool,
  assistantId,
  imageUrls,
  isLoading,
  onImageAdded,
  onImageDeleted,
  onImageUpdated,
  searchTerm,
  matchIndex,
}: {
  tool: ToolBlock.ITool;
  assistantId: string;
  imageUrls: ImageUrl[];
  isLoading: boolean;
  onImageAdded: (url: ImageUrl) => void;
  onImageDeleted: (url: ImageUrl) => void;
  onImageUpdated: (url: ImageUrl) => void;
  searchTerm: string;
  matchIndex: number;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingImage, setEditingImage] = useState<ImageUrl | null>(null);
  const [newUrl, setNewUrl] = useState('');
  const [newAlbum, setNewAlbum] = useState('');
  const tableBodyRef = useRef<HTMLTableSectionElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const tableBody = tableBodyRef.current;
    if (!tableBody || !searchTerm.trim()) return;

    // Clean up previously styled matches
    tableBody.querySelectorAll('[data-match-styled="true"]').forEach((el) => {
      const match = el as HTMLElement;
      match.style.backgroundColor = '';
      match.style.color = '';
      match.removeAttribute('data-match-styled');
    });

    const allMatches = Array.from(
      tableBody.querySelectorAll('[data-match="true"]')
    ) as HTMLElement[];

    if (allMatches.length === 0) return;

    allMatches.forEach((match, index) => {
      if (index === matchIndex) {
        match.style.backgroundColor = 'orange';
      } else {
        match.style.backgroundColor = 'yellow';
      }
      match.style.color = 'black';
      match.setAttribute('data-match-styled', 'true');
    });

    const currentMatchElement = allMatches[matchIndex];
    if (currentMatchElement) {
      currentMatchElement.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [searchTerm, matchIndex, imageUrls]);

  const getHighlightedText = (text: string, highlight: string) => {
    if (!highlight.trim()) {
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
          )
        )}
      </span>
    );
  };

  const form = useForm<z.infer<typeof urlFormSchema>>({
    resolver: zodResolver(urlFormSchema),
    defaultValues: {
      url: '',
      album: '',
    },
  });

  const onSubmit = async (values: z.infer<typeof urlFormSchema>) => {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/contentList', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          assistant_id: assistantId,
          toolId: tool._id ?? '',
          userId: 'anonymous', // TODO: Get actual user ID
          content: [
            {
              url: values.url,
              album: values.album,
            },
          ],
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const newImageUrl = {
            ...result.data.content[0],
            photoId: result.data._id,
            _id: result.data.content[0]._id || '',
            album: result.data.content[0].album || '',
          };
          onImageAdded(newImageUrl);
          form.reset();
        }
      } else {
        throw new Error('Failed to add photo');
      }
    } catch (error) {
      console.error('Error adding photo:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to add photo URL',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteImage = async (url: ImageUrl) => {
    try {
      const response = await fetch(`/api/contentDetail/${url.photoId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        const result = await response.json();
        if (result.success) {
          onImageDeleted(url);
        }
      } else {
        throw new Error('Failed to delete photo');
      }
    } catch (error) {
      console.error('Error deleting photo:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to delete photo URL',
        variant: 'destructive',
      });
    }
  };

  const handleUpdateUrl = async () => {
    if (!editingImage || !newUrl || !newAlbum) {
      return;
    }

    try {
      const response = await fetch(`/api/contentDetail/${editingImage.photoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          _id: editingImage._id,
          url: newUrl,
          album: newAlbum,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        if (result.success && result.data) {
          const updatedImageUrl: ImageUrl = {
            ...editingImage,
            url: newUrl,
            album: newAlbum,
          };
          onImageUpdated(updatedImageUrl);

          setEditingImage(null);
          setNewUrl('');
          setNewAlbum('');

          toast({
            title: 'Success',
            description: 'Photo details updated successfully',
          });
        }
      } else {
        throw new Error('Failed to update photo');
      }
    } catch (error) {
      console.error('Error updating photo:', error);
      toast({
        title: 'Error',
        description:
          error instanceof Error
            ? error.message
            : 'Failed to update photo details',
        variant: 'destructive',
      });
    }
  };

  const onError = (errors: FieldErrors<z.infer<typeof urlFormSchema>>) => {
    console.log(errors);
  };

  const handleEditClick = (image: ImageUrl) => {
    setEditingImage(image);
    setNewUrl(image.url);
    setNewAlbum(image.album);
  };

  return (
    <Card className='w-full mt-4  p-0'>
      <CardHeader className='p-0'>
        <CardTitle>Photo URLs</CardTitle>
        <CardDescription>
          Add photo URLs to your voicebot to use in your calls.
        </CardDescription>

        <Form {...form}>
          <div className='flex w-full gap-2'>
            <FormField
              control={form.control}
              name='url'
              render={({ field }) => (
                <FormItem className='flex-grow'>
                  <FormControl>
                    <Input
                      placeholder='Enter new image URL'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name='album'
              render={({ field }) => (
                <FormItem className='w-[200px]'>
                  <FormControl>
                    <Input
                      placeholder='Album name'
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              disabled={isSubmitting}
              onClick={form.handleSubmit(onSubmit, onError)}
              className='mt-2'
            >
              {isSubmitting ? (
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              ) : null}
              Add URL
            </Button>
          </div>
        </Form>
      </CardHeader>

      {imageUrls.length > 0 && (
      <CardContent className='max-h-[600px] overflow-y-auto p-0'>
        {isLoading ? (
          <div className='flex justify-center items-center h-full'>
            <Loader2 className='h-4 w-4 animate-spin' />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Image</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Album</TableHead>
                <TableHead className='text-right'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody ref={tableBodyRef}>
              {imageUrls.map((imageUrl) => (
                <TableRow key={imageUrl._id}>
                  <TableCell>
                    <HoverCard>
                      <HoverCardTrigger>
                        <img
                          src={imageUrl.url}
                          alt={imageUrl.album}
                          className='h-16 w-16 object-cover rounded'
                        />
                      </HoverCardTrigger>
                      <HoverCardContent>
                        <img
                          src={imageUrl.url}
                          alt={imageUrl.album}
                          className='w-full h-auto object-contain'
                        />
                      </HoverCardContent>
                    </HoverCard>
                  </TableCell>
                  <TableCell>
                    <span className='truncate max-w-[600px] block'>
                      {getHighlightedText(imageUrl.url, searchTerm)}
                    </span>
                  </TableCell>
                  <TableCell className='truncate max-w-[200px]'>
                    {getHighlightedText(imageUrl.album, searchTerm)}
                  </TableCell>
                  <TableCell className='flex items-center gap-2'> 
                    <Dialog
                      open={editingImage?._id === imageUrl._id}
                      onOpenChange={(open) => {
                        if (!open) {
                          setEditingImage(null);
                          setNewUrl("");
                          setNewAlbum("");
                        }
                      }}
                    >
                      <DialogTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleEditClick(imageUrl)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <div className="space-y-4">
                          <h2 className="text-lg font-semibold">Edit Image Details</h2>
                          <div className="space-y-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Image URL</label>
                              <Input
                                value={newUrl}
                                onChange={(e) => setNewUrl(e.target.value)}
                                placeholder="Enter new URL"
                              />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">Album Name</label>
                              <Input
                                value={newAlbum}
                                onChange={(e) => setNewAlbum(e.target.value)}
                                placeholder="Enter album name"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => {
                                setEditingImage(null);
                                setNewUrl("");
                                setNewAlbum("");
                              }}
                            >
                              Cancel
                            </Button>
                            <Button 
                              type="button"
                              onClick={handleUpdateUrl}
                              disabled={!newUrl || !newAlbum}
                            >
                              Update
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button
                      type="button"
                      variant='destructive'
                      size='icon'
                      onClick={() => handleDeleteImage(imageUrl)}
                    >
                      <Trash2 className='h-4 w-4' />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      )}
    </Card>
  );
}
