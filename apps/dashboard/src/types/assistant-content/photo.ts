import { z } from 'zod';

export interface Photo {
  _id?: string;
  album: string;
  assistant_id: string;
  imageUrls: Array<{
    _id?: string;
    album?: string;
    information?: { text?: string };
    url: string;
  }>;
  toolId?: string;
  userId: string;
}

export interface ImageUrl {
  url: string;
  _id: string;
  album: string;
  photoId?: string;
}

export const PhotoSchema = z.object({
  _id: z.string().optional(),
  album: z.string(),
  assistant_id: z.string(),
  imageUrls: z.array(z.object({
    _id: z.string().optional(),
    album: z.string().optional(),
    information: z.object({ text: z.string().optional() }).optional(),
    url: z.string().url(),
  })),
  toolId: z.string().optional(),
  userId: z.string(),
}); 