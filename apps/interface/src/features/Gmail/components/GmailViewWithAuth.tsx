/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
// Migrated from components/gmail-view-with-auth.tsx into feature folder
// Feature structure: features/Gmail/components/GmailViewWithAuth.tsx
// Only UI/client logic lives here. Server/API logic moved under routes/ & services/.
import { useIncrementalAuth } from '@nia/prism/core/hooks/useIncrementalAuth';
import { GOOGLE_SCOPES } from '@nia/prism/core/oauth/incremental-auth.types';
import { GmailAuthRecoveryService } from '@nia/prism/core/services/gmail-auth-recovery.service';
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  Lock,
  Mail,
  MessageSquare,
  Scan,
  Shield
} from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useLLMMessaging } from '@interface/lib/daily';
import { getClientLogger } from '@interface/lib/client-logger';

const GmailViewWithAuth = () => {
  const logger = getClientLogger('GmailViewWithAuth');
  const { data: session } = useSession();
  const { checkScopes, requestGmailAccess } = useIncrementalAuth();
  const { sendMessage, isReady } = useLLMMessaging();
  const initialScanAttempted = useRef(false);

  const [iframeError, setIframeError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasGmailAccess, setHasGmailAccess] = useState(false);
  const [checkingPermissions, setCheckingPermissions] = useState(true);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [scanningInbox, setScanningInbox] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<any>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showAuthRecovery, setShowAuthRecovery] = useState(false);
  const [authRecoveryUrl, setAuthRecoveryUrl] = useState<string | null>(null);

  useEffect(() => {
    if (session?.user?.id) {
      checkGmailPermissions();
    }
  }, [session]);

  const checkGmailPermissions = async () => {
    try {
      const status = await checkScopes([GOOGLE_SCOPES.GMAIL_READONLY]);
      setHasGmailAccess(status.hasScopes);
    } catch (error) {
      logger.error('Error checking Gmail permissions', { error });
      setHasGmailAccess(false);
    } finally {
      setCheckingPermissions(false);
    }
  };

  const tokenRefreshAttempts = useRef(0);
  const MAX_TOKEN_REFRESH_ATTEMPTS = 3;

  const handleAuthenticationFailure = async (error: any) => {
    logger.info('Handling authentication failure', { error });
    try {
      if (tokenRefreshAttempts.current >= MAX_TOKEN_REFRESH_ATTEMPTS) {
        logger.warn('Max token refresh attempts reached', { attempts: tokenRefreshAttempts.current, max: MAX_TOKEN_REFRESH_ATTEMPTS });
        tokenRefreshAttempts.current = 0;
      } else {
        tokenRefreshAttempts.current++;
        logger.info('Attempting silent token refresh', { attempt: tokenRefreshAttempts.current, max: MAX_TOKEN_REFRESH_ATTEMPTS });
        const refreshResult = await GmailAuthRecoveryService.refreshTokenOnly();
        if (refreshResult.success) {
          setTimeout(() => handleScanInbox(), 2000);
          return;
        }
        tokenRefreshAttempts.current = 0; // fallback to reauth
      }

      const recoveryResult = await GmailAuthRecoveryService.triggerGmailReauthorization();
      if (recoveryResult.success && recoveryResult.authUrl) {
        await requestGmailAccess({
          onSuccess: () => {
            setHasGmailAccess(true);
            setShowAuthRecovery(false);
            setAuthRecoveryUrl(null);
            setTimeout(() => handleScanInbox(), 1000);
          },
          onError: () => {
            setAuthRecoveryUrl(recoveryResult.authUrl || null);
            setShowAuthRecovery(true);
          },
          onCancel: () => {
            setAuthRecoveryUrl(recoveryResult.authUrl || null);
            setShowAuthRecovery(true);
          },
        });
      } else {
        await checkGmailPermissions();
      }
    } catch (recoveryError) {
      logger.error('Recovery process failed', { error: recoveryError });
      setScanError('Authentication failed. Please try again.');
    }
  };

  const createAssistantMessage = useCallback((summary: any): string => {
    const { total, unread, important, recentEmails } = summary;
    let message = `📧 Gmail Inbox Analysis:\n\n`;
    if (recentEmails && recentEmails.length > 0) {
      const importantEmails = recentEmails.filter((email: any) => email.isImportant).slice(0, 3);
      const urgentEmails = recentEmails.filter((email: any) => email.isImportant && email.isUnread).slice(0, 2);
      message += `💡 **Assistant Instructions:**\n`;
      message += `Provide a concise prioritized summary focusing on action items, deadlines, required responses.\n`;
      message += `There are ${unread} unread emails.\n`;
      if (unread > 5) message += `User should consider time to process unread pile. `;
      message += `Here are selected emails:\n`;
      const addListing = (list: any[]) => list.forEach((email: any, i: number) => {
        message += `**${i + 1}. From:** ${email.from}\n**Subject:** ${email.subject}\n`;
        message += email.fullContent ? `**Full Content:**\n${email.fullContent}\n` : `**Preview:** ${email.snippet}\n`;
        message += `\n---\n\n`;
      });
      addListing(urgentEmails);
      addListing(importantEmails);
    } else {
      message += `No recent emails to analyze. 🎉`;
    }
    return message;
  }, []);

  const createSpeechFriendlyMessage = useCallback((summary: any): string => {
    const { total, unread, important, recentEmails } = summary;
    if (!recentEmails || recentEmails.length === 0) return 'Your Gmail inbox looks clean! No urgent emails.';
    const urgentEmails = recentEmails.filter((email: any) => email.isImportant && email.isUnread).slice(0, 2);
    let msg = `Scanned your Gmail: ${total} total, ${unread} unread`;
    if (important) msg += `, ${important} important`;
    msg += '. ';
    if (urgentEmails.length) {
      msg += `Urgent: ${urgentEmails.map((e: any) => `${e.subject} from ${e.from}`).join('; ')}. `;
    } else if (important) {
      msg += 'Some important mail but nothing urgent. ';
    }
    msg += unread > 10 ? 'Consider time to clear unread pile.' : 'Inbox is manageable.';
    return msg;
  }, []);

  const handleScanInbox = useCallback(async () => {
    setScanningInbox(true);
    setScanError(null);
    try {
      const response = await fetch('/api/gmail/scan-inbox', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!response.ok) throw new Error(`Failed to scan inbox: ${response.status}`);
      const result = await response.json();
      setLastScanResult(result);
      
      // Send inbox analysis to LLM only if voice session is active
      if (result.analysis && isReady) {
        const analysisMessage = createAssistantMessage(result.analysis);
        const spokenMessage = createSpeechFriendlyMessage(result.analysis);
        
        logger.info('Voice session active, sending inbox summary to assistant');
        
        // Send detailed analysis for LLM processing
        await sendMessage({
          content: analysisMessage,
          role: 'system',
          mode: 'queued'
        });
        
        // Send user-facing spoken summary
        await sendMessage({
          content: spokenMessage,
          role: 'assistant',
          mode: 'queued'
        });
      } else if (result.analysis && !isReady) {
        logger.info('Voice session not active, skipping spoken summary');
      }
    } catch (error: any) {
      const em = error?.message || 'Unknown error';

      if (/401|403|expired|unauthorized/i.test(em)) {
        await handleAuthenticationFailure(error);
      } else {
        setScanError(em);
      }
    } finally {
      setScanningInbox(false);
    }
  }, [createAssistantMessage, createSpeechFriendlyMessage, handleAuthenticationFailure, sendMessage, isReady]);

  useEffect(() => {
    if (hasGmailAccess && !scanningInbox && !lastScanResult && !initialScanAttempted.current && !scanError) {
      initialScanAttempted.current = true;
      const id = setTimeout(() => handleScanInbox(), 500);
      return () => clearTimeout(id);
    }
  }, [hasGmailAccess, scanningInbox, lastScanResult, scanError, handleScanInbox]);

  const handleRequestGmailAccess = async () => {
    setRequestingPermission(true);
    await requestGmailAccess({
      onSuccess: () => {
        setHasGmailAccess(true);
        setRequestingPermission(false);
        setTimeout(() => handleScanInbox(), 1000);
      },
      onError: () => setRequestingPermission(false),
      onCancel: () => setRequestingPermission(false),
    });
  };

  const openInNewTab = () => window.open('https://mail.google.com', '_blank', 'noopener,noreferrer');

  if (checkingPermissions) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Checking Gmail permissions...</p>
        </div>
      </div>
    );
  }

  if (showAuthRecovery && authRecoveryUrl) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <AlertTriangle className="w-16 h-16 text-orange-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-3">Gmail Access Needs Renewal</h3>
          <p className="text-gray-600 mb-6 leading-relaxed">Permissions expired or revoked. Re-authorize to continue.</p>
          <div className="flex flex-col gap-3">
            <a href={authRecoveryUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Shield className="w-4 h-4 mr-2" />Re-authorize Gmail Access
            </a>
            <button onClick={() => setShowAuthRecovery(false)} className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasGmailAccess) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <Lock className="w-16 h-16 text-blue-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-3">Gmail Integration Available</h3>
          <p className="text-gray-600 mb-6 leading-relaxed">Grant read access to analyze and summarize your inbox.</p>
          <div className="space-y-4">
            <button onClick={handleRequestGmailAccess} disabled={requestingPermission} className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${requestingPermission ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'}`}>
              {requestingPermission ? <div className="flex items-center justify-center space-x-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" /><span>Requesting permission...</span></div> : <div className="flex items-center justify-center space-x-2"><Mail className="w-4 h-4" /><span>Enable Gmail Integration</span></div>}
            </button>
            <button onClick={openInNewTab} className="w-full px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors duration-200">
              <div className="flex items-center justify-center space-x-2"><ExternalLink className="w-4 h-4" /><span>Open Gmail in New Tab</span></div>
            </button>
          </div>
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-left">
            <div className="flex items-start space-x-2">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">Privacy & Security</p>
                <p>We use Google&apos;s OAuth and only request read access; revoke anytime in Google settings.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (hasGmailAccess) {
    return (
      <div className="w-full h-full bg-gray-50 flex items-center justify-center">
        <div className="text-center p-8 max-w-md">
          <Mail className="w-16 h-16 text-blue-500 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-800 mb-3">✅ Gmail Access Active!</h3>
            <p className="text-gray-600 mb-6 leading-relaxed">Gmail can&apos;t be embedded, but you can open it or scan for a summarized analysis.</p>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <button onClick={openInNewTab} className="flex items-center justify-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"><ExternalLink className="w-4 h-4 mr-2" />Open Gmail</button>
              <button onClick={handleScanInbox} disabled={scanningInbox} className="flex items-center justify-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50">{scanningInbox ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Scanning...</> : <><Scan className="w-4 h-4 mr-2" />Scan Inbox & Send</>}</button>
            </div>
            {scanError && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center space-x-2 mb-2"><AlertTriangle className="w-4 h-4 text-red-600" /><span className="text-sm font-medium text-red-700">Scan Error</span></div>
                <div className="text-sm text-red-600 mb-3"><p>{scanError}</p></div>
                <button onClick={() => { setScanError(null); initialScanAttempted.current = false; handleScanInbox(); }} className="text-sm bg-red-600 text-white px-3 py-1 rounded hover:bg-red-700 transition-colors">Retry Scan</button>
              </div>
            )}
            {lastScanResult && (
              <div className="mb-6 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-2 mb-2"><MessageSquare className="w-4 h-4 text-gray-600" /><span className="text-sm font-medium text-gray-700">Last Scan Result</span></div>
                <div className="text-sm text-gray-600">
                  <p>✅ Scanned {lastScanResult.scannedEmails} emails</p>
                  <p>📧 Total: {lastScanResult.analysis?.total} | Unread: {lastScanResult.analysis?.unread} | Important: {lastScanResult.analysis?.important}</p>
                  <p className="text-xs text-gray-500 mt-1">Analysis sent at {new Date(lastScanResult.timestamp).toLocaleTimeString()}</p>
                </div>
              </div>
            )}
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-left">
              <div className="flex items-start space-x-2"><Shield className="w-5 h-5 text-green-600 mt-0.5" /><div className="text-sm text-green-800"><p className="font-medium mb-1">Integration Status: Active ✅</p><p>OAuth flow succeeded; ready for Gmail API operations.</p></div></div>
            </div>
        </div>
      </div>
    );
  }
  return null;
};

export default GmailViewWithAuth;
