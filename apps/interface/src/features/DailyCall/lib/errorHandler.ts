/**
 * Global error handling utilities for Daily.co and application errors
 */

import { getClientLogger } from '@interface/lib/client-logger';

/**
 * Suppress specific Daily.co errors that don't affect functionality
 */
const SUPPRESSED_ERRORS = [
  'NotAllowedError: Permission denied by user',
  'blocked-by-browser', 
  'Permission denied by user',
  'Error starting ScreenShare: blocked-by-browser: NotAllowedError: Permission denied by user',
  'Error changing microphone:',
  'Error changing camera:',
  'Error changing speaker:',
  'Failed to change microphone',
  'Failed to change camera',
  'Failed to change speaker'
];

/**
 * Check if an error should be suppressed from displaying to the user
 */
export function shouldSuppressError(error: any) {
  if (!error) return false;
  
  const errorMessage = error.message || error.toString();
  return SUPPRESSED_ERRORS.some(suppressedError => 
    errorMessage.includes(suppressedError)
  );
}

const log = getClientLogger('[daily_call]');

/**
 * Enhanced error handler for Daily.co operations
 */
export function handleDailyError(error: any, operation = 'operation') {
  log.error('Daily.co operation error', {
    event: 'daily_call_operation_error',
    operation,
    error,
  });
  
  // Don't show UI errors for certain expected errors
  if (shouldSuppressError(error)) {
    log.info('Suppressing expected Daily.co error', {
      event: 'daily_call_operation_error_suppressed',
      operation,
      error: error?.message ?? String(error),
    });
    return null;
  }
  
  return error;
}

/**
 * Global error handler to catch unhandled promise rejections
 */
export function setupGlobalErrorHandling() {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    log.warn('Unhandled promise rejection', {
      event: 'daily_call_unhandled_rejection',
      reason: event.reason,
    });
    
    // Suppress certain Daily.co errors from showing in the console
    if (shouldSuppressError(event.reason)) {
      log.info('Suppressing unhandled rejection', {
        event: 'daily_call_unhandled_rejection_suppressed',
        reason: event.reason,
      });
      event.preventDefault();
      return;
    }
    
    // For development, you might want to see these errors
    if (process.env.NODE_ENV === 'development') {
      log.error('Unhandled promise rejection details', {
        event: 'daily_call_unhandled_rejection_detail',
        reason: event.reason,
      });
    }
  });
  
  // Handle general errors
  window.addEventListener('error', (event) => {
    log.warn('Global error', {
      event: 'daily_call_global_error',
      error: event.error,
    });
    
    if (shouldSuppressError(event.error)) {
      log.info('Suppressing global error', {
        event: 'daily_call_global_error_suppressed',
        error: event.error,
      });
      event.preventDefault();
      return;
    }
  });

  // For now, just log suppressed errors without overriding console.error
  const suppressedErrorPatterns = [
    'Error starting ScreenShare',
    'blocked-by-browser', 
    'NotAllowedError: Permission denied by user',
    'Error changing microphone:',
    'Error changing camera:',
    'Error changing speaker:'
  ];
  
  // Alternative: Use a custom logger for suppressed errors
  window.addEventListener('error', (event) => {
    const errorMessage = event.error?.message || event.message || '';
    const shouldSuppress = suppressedErrorPatterns.some(pattern => 
      errorMessage.includes(pattern)
    );
    
    if (shouldSuppress) {
      log.info('Suppressed error', {
        event: 'daily_call_global_error_suppressed_pattern',
        error: errorMessage,
      });
      event.preventDefault();
    }
  });
}

/**
 * Wrap Daily.co operations with error handling
 */
export function wrapDailyOperation<T extends (...args: any[]) => any>(operation: T, operationName = 'Daily operation'): T {
  return (async (...args: Parameters<T>) => {
    try {
      return await operation(...args);
    } catch (error) {
      const handledError = handleDailyError(error, operationName);
      if (handledError) {
        throw handledError;
      }
      // Error was suppressed, return null or handle gracefully
      return null;
    }
  }) as T;
}
