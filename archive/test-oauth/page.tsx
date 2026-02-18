'use client';

export const dynamic = "force-dynamic";

import { useState } from 'react';
import { useIncrementalAuth } from '@nia/prism/core/hooks/useIncrementalAuth';

export default function TestOAuthPage() {
  const [result, setResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  
  const { requestGmailAccess, checkScopes } = useIncrementalAuth();

  const handleTestOAuth = async () => {
    setIsLoading(true);
    setResult('Starting OAuth test...');
    
    try {
      await requestGmailAccess({
        onSuccess: (scopes: string[]) => {
          setResult(`✅ SUCCESS! Granted scopes: ${scopes.join(', ')}`);
          setIsLoading(false);
        },
        onError: (error: string) => {
          setResult(`❌ ERROR: ${error}`);
          setIsLoading(false);
        },
        onCancel: () => {
          setResult(`⚠️ CANCELLED: User cancelled authorization`);
          setIsLoading(false);
        }
      });
    } catch (error) {
      setResult(`💥 EXCEPTION: ${error}`);
      setIsLoading(false);
    }
  };

  const handleCheckScopes = async () => {
    setIsLoading(true);
    try {
      const status = await checkScopes(['https://www.googleapis.com/auth/gmail.readonly']);
      setResult(`📋 Current scope status: ${JSON.stringify(status, null, 2)}`);
    } catch (error) {
      setResult(`❌ Error checking scopes: ${error}`);
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md mx-auto bg-white rounded-lg shadow-md p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">OAuth CORS Test</h1>
        
        <div className="space-y-4">
          <button
            onClick={handleTestOAuth}
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Testing...' : 'Test Gmail OAuth'}
          </button>
          
          <button
            onClick={handleCheckScopes}
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Check Current Scopes
          </button>
        </div>
        
        {result && (
          <div className="mt-6 p-4 bg-gray-50 rounded-md">
            <h3 className="text-sm font-medium text-gray-900 mb-2">Result:</h3>
            <pre className="text-xs text-gray-600 whitespace-pre-wrap">{result}</pre>
          </div>
        )}
        
        <div className="mt-6 text-xs text-gray-500">
          <p><strong>Test Instructions:</strong></p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Click "Test Gmail OAuth"</li>
            <li>Complete the authorization in the popup</li>
            <li>Check if you get a success message (not cancellation)</li>
            <li>Use "Check Current Scopes" to verify permissions</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
