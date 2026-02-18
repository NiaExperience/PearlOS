/**
 * Dog Feeding Tracker Demo Example
 * 
 * A complete HtmlGeneration demo that showcases:
 * - Real API integration with Prism Mesh
 * - Content definition creation and management
 * - CRUD operations on feeding entries
 * - Mobile-responsive design
 * - Error handling and user feedback
 * - User-specific content types to prevent namespace collisions
 * - Complete cleanup capabilities
 */

export { DOG_FEEDING_ENTRY_CONTENT_TYPE, createDogFeedingContentType } from './content-type';
export { createHtmlGenerationRecord, createDogFeedingTrackerHTML } from './create-demo';
export { cleanupDogFeedingDemo, performCleanup } from './cleanup-demo';
export type { CleanupStats } from './cleanup-demo';
