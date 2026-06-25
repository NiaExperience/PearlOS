export interface FileSpaceEntry {
  name: string;
  kind: 'folder' | 'file';
  path: string;
  parentPath: string;
  size?: string;
  sizeBytes?: number;
  ext?: string;
  modifiedAt?: string;
}

export interface FileSpaceSearchResult extends FileSpaceEntry {
  score: number;
  matchReason: string;
  previewChildren?: FileSpaceEntry[];
}

export interface FileSpaceSearchResponse {
  query: string;
  openedPath: string;
  message: string;
  best?: FileSpaceSearchResult;
  results: FileSpaceSearchResult[];
}

export type FileSpaceViewMode = 'grid' | 'list';
