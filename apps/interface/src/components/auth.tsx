'use client';


import { signIn } from 'next-auth/react';
import { useEffect } from 'react';

import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';
import { useLLMMessaging } from '@interface/lib/daily';
import { MessageTypeEnum, Message } from '@interface/types/conversation.types';


const Authenticate = () => {
  const logger = getClientLogger('[auth_component]');
  const { data: session, status, hasError } = useResilientSession();
  const { sendMessage } = useLLMMessaging();
  
  // Debug session issues
  useEffect(() => {
    if (hasError) {
      localStorage.setItem('auth_error_log', JSON.stringify({
        time: new Date().toISOString(),
        status,
        hasError,
        sessionData: session,
      }));
    }
  }, [hasError, status, session]); // Corrected dependency array

  // Automatic anonymous sign-in
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (status === 'loading') return;
    
    // Don't auto-sign-in if user is on login page
    if (window.location.pathname === '/login') return;
    
    // Only auto-sign-in if there's no session at all (first-time visitors)
    if (!session?.user) {
      // No session, sign in as guest
      signIn('credentials', {
        isAnonymous: true,
        redirect: false,
        callbackUrl: '/',
      });
    }
  }, [session, status]);

  useEffect(() => {
    const onMessageUpdate = async (message: Message) => {
      if (
        message.type === MessageTypeEnum.FUNCTION_CALL &&
        message.function?.name === 'getCurrentUser'
      ) {
        try {
          // If we have a session, use that data directly instead of fetching
          if (session && session.user) {
            await sendMessage({
              content: `User found: ${session.user.name || session.user.email}`,
              role: 'system',
              mode: 'queued'
            });
            return;
          }
          
          // Fall back to API if needed
          // TODO: call contentDetail / contentList here instead if possible
          const response = await fetch(`/api/check`, {
            method: 'POST',
            body: JSON.stringify({
              message,
            }),
          });

          const user = await response.json();

          if (response.status === 400) {
            await sendMessage({
              content: user.result,
              role: 'system',
              mode: 'queued'
            });
            return;
          }

          await sendMessage({
            content: `User found: ${user.result}`,
            role: 'system',
            mode: 'queued'
          });
        } catch (error) {
          logger.error('Error processing POST request', {
            error: error instanceof Error ? error.message : String(error),
          });
          await sendMessage({
            content: 'Something went wrong. Please try again.',
            role: 'system',
            mode: 'queued'
          });
        }
      } 
    };

    return () => {
      // Cleanup no longer needed
    };
  }, [sendMessage, session]);

  return (
    <div>
      {/* Removed guest login button and related logic */}
    </div>
  );
};

export default Authenticate;
