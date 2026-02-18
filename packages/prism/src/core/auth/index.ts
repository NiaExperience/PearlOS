// Export all auth utilities
export * from './auth.middleware';
export * from './middleware';

// Conditional export for getSessionSafely
// Use the server version in server code, client version in client code
export { getSessionSafely } from './getSessionSafely';
//export { getSessionSafely as getSessionSafelyClient } from './client/getSessionSafely'; 