/**
 * Creation Engine Templates Package
 * 
 * Contains library templates for the HTML generation creation engine
 * and storage utilities for applet persistence.
 */

// Storage library utilities
export {
  buildStorageBootstrapSnippet,
  buildStorageLibraryAppendix,
  buildStorageLibraryCode,
} from './storage-library.template';
export type { StorageLibraryOptions } from './storage-library.template';

// Library templates
export {
  buildLibraryAppendix,
  buildPromptFriendlyTemplateGuidance,
  getAllTemplateIds,
  getLibraryTemplates,
  getLibraryTypes,
  resolveLibraryTemplate,
  summarizeLibraryOptions,
} from './library-templates';
export type { LibraryAppendix, LibraryTemplateDescriptor, LibraryType } from './library-templates';
