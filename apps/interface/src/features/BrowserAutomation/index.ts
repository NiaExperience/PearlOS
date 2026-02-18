/**
 * BrowserAutomation Feature
 * Export server side bits only here, do not include client components
 */


// Core definitions and types
export * from './definition';

// Actions and services
export * from './actions';
export * from './services';


// NOTE: Client-side UI components (RealBrowserView, wrappers, toggles) should be imported directly
// from their paths, or we can later provide a dedicated client index if needed.
