'use client';

import React, { useState } from 'react';
import { Mail, FileText, Calendar, Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { useIncrementalAuth } from '../hooks/useIncrementalAuth';
import { getLogger } from '../logger';

const log = getLogger('prism:auth:incremental');

interface ScopePermissionCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  scopes: string[];
  onPermissionGranted?: (grantedScopes: string[]) => void;
  onPermissionDenied?: (error: string) => void;
  className?: string;
}

/**
 * Component for requesting specific OAuth scopes with user-friendly UI
 */
export function ScopePermissionCard({
  title,
  description,
  icon,
  scopes,
  onPermissionGranted,
  onPermissionDenied,
  className = '',
}: ScopePermissionCardProps) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'requesting' | 'granted' | 'denied'>('idle');
  const [error, setError] = useState<string | null>(null);
  
  const { requestScopes, checkScopes } = useIncrementalAuth();

  const handleRequestPermission = async () => {
    setStatus('checking');
    setError(null);

    try {
      // First check if user already has these scopes
      const scopeStatus = await checkScopes(scopes);
      
      if (scopeStatus.hasScopes) {
        setStatus('granted');
        onPermissionGranted?.(scopeStatus.grantedScopes);
        return;
      }

      setStatus('requesting');

      await requestScopes({
        scopes,
        reason: description,
        onSuccess: (grantedScopes) => {
          setStatus('granted');
          onPermissionGranted?.(grantedScopes);
        },
        onError: (error) => {
          setStatus('denied');
          setError(error);
          onPermissionDenied?.(error);
        },
        onCancel: () => {
          setStatus('idle');
        },
      });

    } catch (err) {
      setStatus('denied');
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      onPermissionDenied?.(errorMessage);
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'granted': return 'border-green-200 bg-green-50';
      case 'denied': return 'border-red-200 bg-red-50';
      case 'requesting': return 'border-blue-200 bg-blue-50';
      default: return 'border-gray-200 bg-white hover:bg-gray-50';
    }
  };

  const getButtonText = () => {
    switch (status) {
      case 'checking': return 'Checking...';
      case 'requesting': return 'Requesting permission...';
      case 'granted': return 'Permission granted';
      case 'denied': return 'Try again';
      default: return 'Grant permission';
    }
  };

  const isButtonDisabled = () => {
    return status === 'checking' || status === 'requesting' || status === 'granted';
  };

  return (
    <div className={`border rounded-lg p-6 transition-all duration-200 ${getStatusColor()} ${className}`}>
      <div className="flex items-start space-x-4">
        <div className="flex-shrink-0">
          {status === 'granted' ? (
            <CheckCircle className="w-6 h-6 text-green-600" />
          ) : status === 'denied' ? (
            <AlertTriangle className="w-6 h-6 text-red-600" />
          ) : (
            <div className="w-6 h-6 text-gray-600">{icon}</div>
          )}
        </div>
        
        <div className="flex-grow">
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
          <p className="text-gray-600 mt-1">{description}</p>
          
          {error && (
            <div className="mt-3 p-3 bg-red-100 border border-red-200 rounded-md">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          
          <div className="mt-4">
            <button
              onClick={handleRequestPermission}
              disabled={isButtonDisabled()}
              className={`
                px-4 py-2 rounded-md text-sm font-medium transition-colors duration-200
                ${isButtonDisabled() 
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                  : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                }
              `}
            >
              {getButtonText()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Pre-configured components for common Google services
 */
export function GmailPermissionCard(props: Omit<ScopePermissionCardProps, 'title' | 'description' | 'icon' | 'scopes'>) {
  return (
    <ScopePermissionCard
      title="Gmail Access"
      description="Allow access to your Gmail messages for email integration features"
      icon={<Mail />}
      scopes={['https://www.googleapis.com/auth/gmail.readonly']}
      {...props}
    />
  );
}

export function DrivePermissionCard(props: Omit<ScopePermissionCardProps, 'title' | 'description' | 'icon' | 'scopes'>) {
  return (
    <ScopePermissionCard
      title="Google Drive Access"
      description="Allow access to your Google Drive files for document integration"
      icon={<FileText />}
      scopes={['https://www.googleapis.com/auth/drive.readonly']}
      {...props}
    />
  );
}

export function CalendarPermissionCard(props: Omit<ScopePermissionCardProps, 'title' | 'description' | 'icon' | 'scopes'>) {
  return (
    <ScopePermissionCard
      title="Google Calendar Access"
      description="Allow access to your Google Calendar to show upcoming events"
      icon={<Calendar />}
      scopes={['https://www.googleapis.com/auth/calendar.readonly']}
      {...props}
    />
  );
}

/**
 * Component for displaying all permission requests at once
 */
export function GooglePermissionManager() {
  const [grantedPermissions, setGrantedPermissions] = useState<string[]>([]);

  const handlePermissionGranted = (service: string, scopes: string[]) => {
    setGrantedPermissions(prev => [...prev, service]);
    log.info(`${service} permission granted`, { scopes });
  };

  const handlePermissionDenied = (service: string, error: string) => {
    log.error(`${service} permission denied`, { error });
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Enhanced Google Integration
        </h2>
        <p className="text-gray-600">
          Grant additional permissions to unlock more features. You can revoke these permissions at any time 
          in your Google Account settings.
        </p>
      </div>

      <div className="space-y-6">
        <GmailPermissionCard
          onPermissionGranted={(scopes) => handlePermissionGranted('Gmail', scopes)}
          onPermissionDenied={(error) => handlePermissionDenied('Gmail', error)}
        />
        
        <DrivePermissionCard
          onPermissionGranted={(scopes) => handlePermissionGranted('Drive', scopes)}
          onPermissionDenied={(error) => handlePermissionDenied('Drive', error)}
        />
        
        <CalendarPermissionCard
          onPermissionGranted={(scopes) => handlePermissionGranted('Calendar', scopes)}
          onPermissionDenied={(error) => handlePermissionDenied('Calendar', error)}
        />
      </div>

      {grantedPermissions.length > 0 && (
        <div className="mt-8 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-green-800 font-medium">
              Permissions granted for: {grantedPermissions.join(', ')}
            </span>
          </div>
        </div>
      )}

      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-start space-x-2">
          <Shield className="w-5 h-5 text-gray-600 mt-0.5" />
          <div className="text-sm text-gray-600">
            <p className="font-medium mb-1">Privacy & Security</p>
            <p>
              These permissions use Google's secure OAuth 2.0 protocol. We only request the minimum 
              access needed for each feature, and you can revoke permissions at any time through your 
              Google Account settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
