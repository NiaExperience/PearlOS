import { z } from 'zod';
import { Mic, Calendar, Ship, User, Image, Settings, Box, Activity, Code, File, ImageIcon } from "lucide-react";
import { AgendaSchema } from '../types/assistant-content/agenda';
import { SpeakerSchema } from '../types/assistant-content/speaker';
import { ExhibitorSchema } from '../types/assistant-content/exhibitor';
import { GuestSchema } from '../types/assistant-content/guest';
import { ServiceSchema } from '../types/assistant-content/service';
import { ActivitySchema } from '../types/assistant-content/activity';
import { IframeKeywordSchema } from '../types/assistant-content/iframe-keywords';
import { KeywordMemorySchema } from '../types/assistant-content/keyword-memory';
import { EventMapSchema } from '../types/assistant-content/event-map';
import { PhotoSchema } from '../types/assistant-content/photo';
// No schema for EventMap or Photo in assistant-content, so leave as is or add when available.

// Type annotations for contentConfig
export type ContentConfig = {
  [key: string]: {
    schema: z.ZodSchema<any>;
    collectionName: string;
    requiredFields: string[];
    defaults: Record<string, any>;
  };
};

export type ValidationResult = {
  validData: any[];
  errors: Array<{
    itemIndex: number;
    originalData: any;
    error: any;
  }>;
  hasErrors: boolean;
};

export type UploadProgress = {
  current: number;
  total: number;
  currentItem: string;
  completed: string[];
  errors: string[];
};

export type UploadResults = {
  successful: string[];
  failed: string[];
};

// Content types configuration
export const contentTypes = [
  { label: "Speaker", value: "speaker" },
  { label: "Agenda", value: "agenda" },
  { label: "Exhibitors", value: "exhibitor"},
  { label: "Guest", value: "guest" },
  { label: "Services", value: "services" },
  { label: "Activities", value: "activities" },
  { label: "Photos", value: "photos" },
  { label: "IFrame Keywords", value: "iframeKeywords" },
  { label: "Event Map", value: "eventMap"},
  { label: "Knowledge Keywords", value: "knowledgeKeywords" },
];

// Icon mapping for content types
export const typeIcons = {
  speaker: Mic,
  agenda: Calendar,
  exhibitor: User,
  guest: User,
  services: Settings,
  activities: Activity,
  photos: ImageIcon,
  iframeKeywords: Code,
  knowledgeKeywords: Box,
  eventMap: Image,
};

// Content type configuration mapping with proper defaults based on schemas
export const contentConfig: ContentConfig = {
  speaker: {
    schema: SpeakerSchema,
    collectionName: "nia-speakers",
    requiredFields: ['name', 'title', 'company', 'photo'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  agenda: {
    schema: AgendaSchema,
    collectionName: "nia-agenda",
    requiredFields: ['track', 'title', 'speaker'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  exhibitor: {
    schema: ExhibitorSchema,
    collectionName: "nia-exhibitors",
    requiredFields: ['title', 'location', 'tellMeMore'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  guest: {
    schema: GuestSchema,
    collectionName: "nia-guests",
    requiredFields: ['name', 'phone_number', 'passPhrase'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  services: {
    schema: ServiceSchema,
    collectionName: "nia-services",
    requiredFields: ['item_name', 'price', 'photo_url', 'description', 'category'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  activities: {
    schema: ActivitySchema,
    collectionName: "nia-activities",
    requiredFields: ['excursion_name', 'time', 'description', 'location', 'photo_url', 'category'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  iframeKeywords: {
    schema: IframeKeywordSchema,
    collectionName: "iframekeywords",
    requiredFields: ['name', 'url', 'keywords'],
    defaults: {
      // NO DEFAULTS - only actual user data will be inserted
    }
  },
  knowledgeKeywords: {
    schema: KeywordMemorySchema,
    collectionName: "nia-keyword-memory",
    requiredFields: ['keyword', 'description'],
    defaults: {}
  },
  eventMap: {
    schema: EventMapSchema,
    collectionName: "nia-event-map",
    requiredFields: ['eventName', 'url'],
    defaults: {}
  },
  photos: {
    schema: PhotoSchema,
    collectionName: "nia-photos",
    requiredFields: ['url', 'album'],
    defaults: {}
  }
} as const;

// Helper function to format data with assistant ID
export const formatDataWithAssistantId = (data: any[], assistantId: string) => {
  return data.map(item => ({
    ...item,
    assistant_id: assistantId  // Use string directly, not ObjectId wrapper
  }));
}; 