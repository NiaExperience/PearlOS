
export type NoteMode = 'personal' | 'work';

export interface Note {
  _id?: string;
  title: string;
  content: string;
  mode: NoteMode;
  isPinned?: boolean;
  timestamp?: string;
  userId: string;
  tenantId: string;
  createdAt?: string;
  // Document-related metadata
  sourceFile?: {
    name: string;
    size: number;
    type: 'pdf' | 'docx' | 'csv' | 'md' | 'txt';
    extractedAt?: string;
    pageCount?: number;
  };
  // Sharing metadata (added when note is shared with user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sharedVia?: any;
}
