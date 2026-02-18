'use client';

export const dynamic = "force-dynamic";

import GmailViewWithAuth from '@interface/features/Gmail/components/GmailViewWithAuth';
import { useSession } from 'next-auth/react';

/**
 * Test page for Gmail integration with incremental authorization
 * This demonstrates the complete end-to-end workflow
 */
export default function TestGmailPage() {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <h2 className="text-lg font-semibold text-yellow-800 mb-2">
            Authentication Required
          </h2>
          <p className="text-yellow-700">
            Please sign in to test Gmail integration with incremental authorization.
          </p>
          <div className="mt-4">
            <a 
              href="/login" 
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
            >
              Sign In
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Gmail Integration Test</h1>
      
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">
          Welcome, {session.user?.name || session.user?.email}!
        </h2>
        <p className="text-blue-700">
          This page demonstrates the incremental OAuth authorization workflow for Gmail access.
          The system will first check if you have Gmail permissions, and if not, guide you through
          the process of granting additional scopes.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Gmail Integration</h3>
          <p className="text-sm text-gray-600 mt-1">
            Incremental authorization workflow in action
          </p>
        </div>
        
        <div className="p-4">
          <GmailViewWithAuth />
        </div>
      </div>

      <div className="mt-6 bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2">How it works:</h3>
        <ol className="list-decimal list-inside space-y-2 text-sm text-gray-700">
          <li>The component checks if you already have Gmail read permissions</li>
          <li>If not, it shows a permission request interface</li>
          <li>Clicking "Grant Access" opens a popup with Google's OAuth consent screen</li>
          <li>After consent, Google redirects to our callback handler</li>
          <li>The handler validates the response and updates your account with new scopes</li>
          <li>The popup closes and the Gmail interface becomes available</li>
        </ol>
      </div>

      <div className="mt-4 text-xs text-gray-500">
        <p>
          Session ID: {session.user?.id} | 
          User Type: {session.user?.is_anonymous ? 'Anonymous' : 'Authenticated'}
        </p>
      </div>
    </div>
  );
}
