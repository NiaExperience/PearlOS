'use client';

import { useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { getLogger } from '../logger';

const log = getLogger('prism:auth:incremental');

export interface ScopeRequestOptions {
  scopes: string[];
  reason?: string;
  onSuccess?: (grantedScopes: string[]) => void;
  onError?: (error: string) => void;
  onCancel?: () => void;
}

export interface ScopeStatus {
  hasScopes: boolean;
  grantedScopes: string[];
  missingScopes: string[];
  loading: boolean;
  error: string | null;
}

/**
 * React hook for managing incremental OAuth scope requests
 */
export function useIncrementalAuth() {
  const { data: session } = useSession();
  const [requestInProgress, setRequestInProgress] = useState(false);

  /**
   * Check if user has specific scopes
   */
  const checkScopes = useCallback(async (scopes: string[]): Promise<ScopeStatus> => {
    try {
      const response = await fetch(`/api/google/incremental-scope?scopes=${scopes.join(',')}`);
      
      if (!response.ok) {
        throw new Error('Failed to check scope status');
      }

      const data = await response.json();
      
      return {
        hasScopes: data.hasScopes,
        grantedScopes: data.grantedScopes || [],
        missingScopes: data.missingScopes || [],
        loading: false,
        error: null,
      };
    } catch (error) {
      return {
        hasScopes: false,
        grantedScopes: [],
        missingScopes: scopes,
        loading: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }, []);

  /**
   * Request additional scopes from user
   */
  const requestScopes = useCallback(async (options: ScopeRequestOptions) => {
    if (!session?.user) {
      options.onError?.('User not authenticated');
      return;
    }

    if (requestInProgress) {
      return; // Prevent duplicate requests
    }

    setRequestInProgress(true);

    try {
      // First check if user already has these scopes
      const scopeStatus = await checkScopes(options.scopes);
      
      if (scopeStatus.hasScopes) {
        options.onSuccess?.(scopeStatus.grantedScopes);
        return;
      }

      // Request authorization URL
      const response = await fetch('/api/google/incremental-scope', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scopes: options.scopes,
          reason: options.reason,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to request scopes');
      }

      const data = await response.json();

      if (data.hasPermissions) {
        // User already has permissions
        options.onSuccess?.(options.scopes);
        return;
      }

      if (!data.authUrl) {
        throw new Error('No authorization URL received');
      }

      // Open authorization URL in popup
      const popup = window.open(
        data.authUrl,
        'oauth_popup',
        'width=500,height=600,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        throw new Error('Failed to open popup window. Please allow popups for this site.');
      }

      // Listen for popup completion via multiple methods
      let authCompleted = false; // Track if auth has completed to avoid duplicate handling
      
      const handlePopupMessage = (event: MessageEvent) => {
        // Verify origin for security - but allow same-origin and localhost variations
        const allowedOrigins = [
          window.location.origin,
          'http://localhost:3000',
          'http://localhost:4000'
        ];
        
        if (!allowedOrigins.includes(event.origin)) {
          log.warn('Rejected popup message origin', { origin: event.origin, allowedOrigins });
          return;
        }

        log.info('Received popup message', { data: event.data });

        if (authCompleted) {
          log.info('Auth already completed, ignoring duplicate message');
          return;
        }

        if (event.data.type === 'OAUTH_SUCCESS') {
          // Authorization successful
          authCompleted = true;
          log.info('OAuth SUCCESS message received via postMessage');
          cleanup();
          handleOAuthSuccess(event.data.scopes || []);
        } else if (event.data.type === 'OAUTH_ERROR') {
          // Authorization failed
          authCompleted = true;
          log.error('OAuth ERROR message received via postMessage', { error: event.data?.error });
          cleanup();
          options.onError?.(event.data.error || 'Authorization failed');
        } else if (event.data.type === 'OAUTH_CANCEL') {
          // User cancelled
          authCompleted = true;
          log.info('OAuth CANCEL message received via postMessage');
          cleanup();
          options.onCancel?.();
        }
      };

      // Handle localStorage-based communication (fallback)
      const checkLocalStorage = () => {
        if (authCompleted) return false;
        
        const handleStoredOAuthResult = (data: any) => {
          if (data.type === 'OAUTH_SUCCESS') {
            authCompleted = true;
            log.info('OAuth SUCCESS message received via localStorage');
            cleanup();
            handleOAuthSuccess(data.scopes || []);
            return true;
          }

          if (data.type === 'OAUTH_ERROR') {
            authCompleted = true;
            log.error('OAuth ERROR message received via localStorage', { error: data?.error });
            cleanup();
            options.onError?.(data.error || 'Authorization failed');
            return true;
          }

          return false;
        };

        try {
          const storedResult = localStorage.getItem('oauth_result');
          if (!storedResult) return false;

          const data = JSON.parse(storedResult);
          const isRecent = data?.timestamp && (Date.now() - data.timestamp) < 30000;
          if (!isRecent) return false;

          localStorage.removeItem('oauth_result'); // Clean up

          return handleStoredOAuthResult(data);
        } catch (error) {
          log.warn('Error checking localStorage for OAuth result', { error });
        }
        return false;
      };

      // Handle URL hash-based communication (fallback)
      const checkURLHash = () => {
        if (authCompleted) return false;
        
        try {
          const hash = window.location.hash;
          if (hash.startsWith('#oauth-success:')) {
            const dataStr = decodeURIComponent(hash.substring(14));
            const data = JSON.parse(dataStr);
            window.location.hash = ''; // Clean up
            authCompleted = true;
            log.info('OAuth SUCCESS message received via URL hash');
            cleanup();
            handleOAuthSuccess(data.scopes || []);
            return true;
          } else if (hash.startsWith('#oauth-error:')) {
            const dataStr = decodeURIComponent(hash.substring(13));
            const data = JSON.parse(dataStr);
            window.location.hash = ''; // Clean up
            authCompleted = true;
            log.error('OAuth ERROR message received via URL hash', { error: data?.error });
            cleanup();
            options.onError?.(data.error || 'Authorization failed');
            return true;
          }
        } catch (error) {
          log.warn('Error checking URL hash for OAuth result', { error });
        }
        return false;
      };

      // Success handler with enhanced scope checking and longer delays
      const handleOAuthSuccess = (receivedScopes: string[]) => {
        log.info('OAuth success received, checking scopes', { scopes: receivedScopes });
        
        // Check scopes to confirm success with much longer delays to allow server processing
        setTimeout(() => {
          checkScopes(options.scopes).then((scopeStatus) => {
            if (scopeStatus.hasScopes) {
              options.onSuccess?.(scopeStatus.grantedScopes);
            } else {
              // If scopes aren't showing yet, try multiple times with increasing delays
              setTimeout(() => {
                checkScopes(options.scopes).then((retryStatus) => {
                  if (retryStatus.hasScopes) {
                    options.onSuccess?.(retryStatus.grantedScopes);
                  } else {
                    // Third attempt with even longer delay
                    setTimeout(() => {
                      checkScopes(options.scopes).then((thirdStatus) => {
                        if (thirdStatus.hasScopes) {
                          options.onSuccess?.(thirdStatus.grantedScopes);
                        } else {
                          // Final attempt with longest delay
                          setTimeout(() => {
                            checkScopes(options.scopes).then((finalStatus) => {
                              if (finalStatus.hasScopes) {
                                options.onSuccess?.(finalStatus.grantedScopes);
                              } else {
                                log.warn('OAuth success message received but scopes not available after retries');
                                options.onError?.('Authorization completed but permissions not available');
                              }
                            }).catch((error) => {
                              options.onError?.(error.message);
                            });
                          }, 8000); // 8 second final delay - much longer for server processing
                        }
                      }).catch((error) => {
                        options.onError?.(error.message);
                      });
                    }, 5000); // 5 second third attempt
                  }
                }).catch((error) => {
                  options.onError?.(error.message);
                });
              }, 3000); // 3 second retry delay
            }
          }).catch((error) => {
            options.onError?.(error.message);
          });
        }, 2000); // 2 second initial delay - increased from 1s
      };

      // Listen for messages from popup
      window.addEventListener('message', handlePopupMessage);

      // Start fallback timers for localStorage and URL hash checking
      const storageCheckTimer = setInterval(checkLocalStorage, 1000); // Check every second
      const hashCheckTimer = setInterval(checkURLHash, 1000); // Check every second

      // Cleanup function
      let cleanup = () => {
        try {
          popup.close();
        } catch (error) {
          // Ignore CORS errors when closing popup
        }
        setRequestInProgress(false);
        window.removeEventListener('message', handlePopupMessage);
        if (pollTimer) clearInterval(pollTimer);
        if (storageCheckTimer) clearInterval(storageCheckTimer);
        if (hashCheckTimer) clearInterval(hashCheckTimer);
      };

      // Fallback: poll for popup closure (with much longer interval due to CORS issues)
      let pollAttempts = 0;
      const maxPollAttempts = 30; // 30 attempts = 2.5 minutes with 5s intervals
      const pollTimer = setInterval(() => {
        pollAttempts++;
        
        // If auth already completed, stop polling
        if (authCompleted) {
          clearInterval(pollTimer);
          return;
        }
        
        // First, try fallback communication methods
        if (checkLocalStorage() || checkURLHash()) {
          return; // Success or error handled by fallback methods
        }
        
        let popupClosed = false;
        try {
          popupClosed = popup.closed;
        } catch (error) {
          // CORS is blocking popup.closed check
          log.warn('Cannot check popup.closed due to CORS, relying on postMessage');
          
          // Since we can't check popup.closed reliably due to CORS,
          // check if scopes were granted after a reasonable time
          if (pollAttempts > 6) { // After 6 attempts (30 seconds), start checking scopes
            log.info('CORS blocking popup check, checking scopes as fallback');
            
            checkScopes(options.scopes).then((scopeStatus) => {
              if (scopeStatus.hasScopes && !authCompleted) {
                log.info('Scopes available despite CORS popup issues');
                authCompleted = true;
                clearInterval(pollTimer);
                cleanup();
                options.onSuccess?.(scopeStatus.grantedScopes);
                return;
              }
            }).catch((error) => {
              log.warn('Scope check failed during CORS handling', { error });
            });
          }
          
          // Continue polling for fallback methods
          return;
        }
        
        if (popupClosed) {
          clearInterval(pollTimer);
          
          // Only handle popup closure if auth hasn't completed via other means
          if (!authCompleted) {
            log.info('Popup closed, checking scopes');
            
            // Check if we received authorization - if scopes are now available, it was successful
            // Use longer delays to allow server processing time
            setTimeout(() => {
              checkScopes(options.scopes).then((scopeStatus) => {
                if (scopeStatus.hasScopes) {
                  authCompleted = true;
                  cleanup();
                  options.onSuccess?.(scopeStatus.grantedScopes);
                } else {
                  // Try multiple times with increasing delays to give the server time to update
                  setTimeout(() => {
                    checkScopes(options.scopes).then((retryStatus) => {
                      if (retryStatus.hasScopes) {
                        authCompleted = true;
                        cleanup();
                        options.onSuccess?.(retryStatus.grantedScopes);
                      } else {
                        // Third attempt with longer delay
                        setTimeout(() => {
                          checkScopes(options.scopes).then((thirdStatus) => {
                            if (thirdStatus.hasScopes) {
                              authCompleted = true;
                              cleanup();
                              options.onSuccess?.(thirdStatus.grantedScopes);
                            } else {
                              // Final attempt with longest delay
                              setTimeout(() => {
                                checkScopes(options.scopes).then((finalStatus) => {
                                  if (finalStatus.hasScopes) {
                                    authCompleted = true;
                                    cleanup();
                                    options.onSuccess?.(finalStatus.grantedScopes);
                                  } else {
                                    // Only call onCancel as a last resort
                                    log.warn('OAuth popup closed but scopes still not available after multiple retries');
                                    authCompleted = true;
                                    cleanup();
                                    options.onCancel?.();
                                  }
                                }).catch((error) => {
                                  log.error('Final scope check failed', { error });
                                  authCompleted = true;
                                  cleanup();
                                  options.onCancel?.();
                                });
                              }, 8000); // 8 second final delay - much longer
                            }
                          }).catch((error) => {
                            log.error('Third scope check failed', { error });
                            authCompleted = true;
                            cleanup();
                            options.onCancel?.();
                          });
                        }, 5000); // 5 second third attempt
                      }
                    }).catch((error) => {
                      log.error('Retry scope check failed', { error });
                      authCompleted = true;
                      cleanup();
                      options.onCancel?.();
                    });
                  }, 3000); // 3 second retry delay - increased
                }
              }).catch((error) => {
                log.error('Initial scope check failed', { error });
                authCompleted = true;
                cleanup();
                options.onCancel?.();
              });
            }, 2000); // 2 second initial delay - increased
          }
          return;
        }

        // If we can't check popup status due to CORS and we've waited long enough,
        // try checking if scopes were granted as a fallback
        if (pollAttempts >= maxPollAttempts && !authCompleted) {
            log.warn('OAuth process timed out after 2.5 minutes');
          clearInterval(pollTimer);
          
          // Final scope check before giving up
          checkScopes(options.scopes).then((scopeStatus) => {
            if (scopeStatus.hasScopes) {
              authCompleted = true;
              cleanup();
              options.onSuccess?.(scopeStatus.grantedScopes);
            } else {
              authCompleted = true;
              cleanup();
              options.onError?.('OAuth process timed out - please try again');
            }
          }).catch((error) => {
            authCompleted = true;
            cleanup();
            options.onError?.('OAuth process timed out');
          });
        }
      }, 5000); // Check every 5 seconds

      // Final cleanup - emergency fallback
      const emergencyCleanup = setTimeout(() => {
        cleanup();
        if (!options.onError) return;
        options.onError('OAuth process timed out after 15 minutes');
      }, 900000); // 15 minutes total timeout

      // Update cleanup to also clear emergency timeout
      const originalCleanup = cleanup;
      const enhancedCleanup = () => {
        clearTimeout(emergencyCleanup);
        originalCleanup();
      };
      
      // Replace cleanup function references
      cleanup = enhancedCleanup;

    } catch (error) {
      setRequestInProgress(false);
      options.onError?.(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [session, requestInProgress, checkScopes]);

  /**
   * Request specific Google service access
   */
  const requestGmailAccess = useCallback((options?: Omit<ScopeRequestOptions, 'scopes'>) => {
    return requestScopes({
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
      reason: 'Access your Gmail messages to provide email integration features',
      ...options,
    });
  }, [requestScopes]);

  const requestDriveAccess = useCallback((options?: Omit<ScopeRequestOptions, 'scopes'>) => {
    return requestScopes({
      scopes: ['https://www.googleapis.com/auth/drive.readonly'],
      reason: 'Access your Google Drive files to provide document integration',
      ...options,
    });
  }, [requestScopes]);

  const requestCalendarAccess = useCallback((options?: Omit<ScopeRequestOptions, 'scopes'>) => {
    return requestScopes({
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
      reason: 'Access your Google Calendar to show upcoming events',
      ...options,
    });
  }, [requestScopes]);

  /**
   * Explicitly request a token refresh without requiring re-authorization
   * This is useful when the user already has the required scopes but their access token is expired
   */
  const refreshToken = useCallback(async (): Promise<{success: boolean; error?: string}> => {
    try {
      log.info('Explicitly refreshing access token');
      const response = await fetch('/api/google/refresh-token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to refresh token');
      }

      const data = await response.json();
      
      // If the server indicates we should reload the session
      if (data.reloadSession) {
        try {
          // Use signOut and signIn to force a session reload
          log.info('Forcing session reload to update access token');
          
          // Use getSession to force a reload
          const { getSession } = await import('next-auth/react');
          if (typeof getSession === 'function') {
            await getSession();
          }
          
          log.info('Session reloaded with new access token');
        } catch (sessionError) {
          log.warn('Error reloading session', { error: sessionError });
          // Continue anyway since the token is refreshed in the database
        }
      }
      
      log.info('Token refresh successful');
      return { success: true };
    } catch (error) {
      log.error('Token refresh failed', { error });
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error during token refresh'
      };
    }
  }, []);

  return {
    requestScopes,
    requestGmailAccess,
    requestDriveAccess,
    requestCalendarAccess,
    checkScopes,
    refreshToken,
    requestInProgress,
    isAuthenticated: !!session?.user,
  };
}
