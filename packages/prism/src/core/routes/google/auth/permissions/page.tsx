'use client';

import {
  CalendarPermissionCard,
  DrivePermissionCard,
  GmailPermissionCard
} from '@nia/prism/core/components/incremental-auth-components';
import { useIncrementalAuth } from '@nia/prism/core/hooks/useIncrementalAuth';
import { Calendar, FileText, Info, Mail, Shield } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { ReactNode, useEffect, useState } from 'react';
import { getLogger } from '../../../../logger';

const log = getLogger('prism:auth:incremental');

/**
 * Example page demonstrating incremental OAuth scope requests
 * This can be integrated into your existing interface wherever you need additional permissions
 */
export default function IncrementalAuthExample() {
  const { data: session } = useSession();
  const { checkScopes } = useIncrementalAuth();
  const [scopeStatuses, setScopeStatuses] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (session?.user?.id) {
      checkCurrentPermissions();
    }
  }, [session]);

  const checkCurrentPermissions = async () => {
    setLoading(true);
    try {
      const gmailStatus = await checkScopes(['https://www.googleapis.com/auth/gmail.readonly']);
      const driveStatus = await checkScopes(['https://www.googleapis.com/auth/drive.readonly']);
      const calendarStatus = await checkScopes(['https://www.googleapis.com/auth/calendar.readonly']);

      setScopeStatuses({
        gmail: gmailStatus.hasScopes,
        drive: driveStatus.hasScopes,
        calendar: calendarStatus.hasScopes,
      });
    } catch (error) {
      log.error('Error checking permissions', { error });
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionGranted = (service: string, scopes: string[]) => {
    log.info(`${service} permission granted`, { scopes });
    setScopeStatuses(prev => ({ ...prev, [service.toLowerCase()]: true }));
    
    // Here you could trigger any feature-specific logic
    // For example, if Gmail access was granted, you could:
    // - Load the user's email list
    // - Show Gmail integration features
    // - Enable email-related functionality
  };

  const handlePermissionDenied = (service: string, error: string) => {
    log.error(`${service} permission denied`, { error });
    // Handle denial gracefully - maybe show alternative options
  };

  if (!session) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center py-12">
          <Shield className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Authentication Required
          </h2>
          <p className="text-gray-600">
            Please sign in to manage your Google integration permissions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Header />
      <PermissionsOverview loading={loading} scopeStatuses={scopeStatuses} />
      <IntegrationCards onGranted={handlePermissionGranted} onDenied={handlePermissionDenied} />
      <InfoSection />
      <FeaturePreview scopeStatuses={scopeStatuses} />
    </div>
  );
}

function Header() {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-4">
        Google Integration Settings
      </h1>
      <p className="text-lg text-gray-600">
        Enhance your experience by granting additional permissions for Google services. 
        You can enable these features one at a time as needed.
      </p>
    </div>
  );
}

function PermissionsOverview({
  loading,
  scopeStatuses,
}: {
  loading: boolean;
  scopeStatuses: Record<string, boolean>;
}) {
  return (
    <div className="mb-8 p-6 bg-gray-50 rounded-lg">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">
        Current Permissions
      </h2>
      {loading ? (
        <p className="text-gray-600">Checking permissions...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PermissionCard
            label="Gmail"
            icon={<Mail className={`w-5 h-5 ${scopeStatuses.gmail ? 'text-green-600' : 'text-gray-400'}`} />}
            enabled={scopeStatuses.gmail}
          />
          <PermissionCard
            label="Drive"
            icon={<FileText className={`w-5 h-5 ${scopeStatuses.drive ? 'text-green-600' : 'text-gray-400'}`} />}
            enabled={scopeStatuses.drive}
          />
          <PermissionCard
            label="Calendar"
            icon={<Calendar className={`w-5 h-5 ${scopeStatuses.calendar ? 'text-green-600' : 'text-gray-400'}`} />}
            enabled={scopeStatuses.calendar}
          />
        </div>
      )}
    </div>
  );
}

function PermissionCard({ label, icon, enabled }: { label: string; icon: ReactNode; enabled?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border ${enabled ? 'bg-green-50 border-green-200' : 'bg-gray-100 border-gray-200'}`}>
      <div className="flex items-center space-x-2">
        {icon}
        <span className={`font-medium ${enabled ? 'text-green-800' : 'text-gray-600'}`}>
          {label}: {enabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>
    </div>
  );
}

function IntegrationCards({
  onGranted,
  onDenied,
}: {
  onGranted: (service: string, scopes: string[]) => void;
  onDenied: (service: string, error: string) => void;
}) {
  return (
    <div className="space-y-6 mb-8">
      <h2 className="text-xl font-semibold text-gray-900">
        Available Integrations
      </h2>
      <GmailPermissionCard
        onPermissionGranted={(scopes) => onGranted('Gmail', scopes)}
        onPermissionDenied={(error) => onDenied('Gmail', error)}
        className="transition-opacity duration-200"
      />
      <DrivePermissionCard
        onPermissionGranted={(scopes) => onGranted('Drive', scopes)}
        onPermissionDenied={(error) => onDenied('Drive', error)}
        className="transition-opacity duration-200"
      />
      <CalendarPermissionCard
        onPermissionGranted={(scopes) => onGranted('Calendar', scopes)}
        onPermissionDenied={(error) => onDenied('Calendar', error)}
        className="transition-opacity duration-200"
      />
    </div>
  );
}

function InfoSection() {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
      <div className="flex items-start space-x-3">
        <Info className="w-6 h-6 text-blue-600 mt-0.5" />
        <div>
          <h3 className="text-lg font-semibold text-blue-900 mb-2">
            How This Works
          </h3>
          <div className="text-blue-800 space-y-2">
            <p>
              <strong>Incremental Authorization:</strong> We use Google's recommended approach 
              of requesting permissions only when needed for specific features.
            </p>
            <p>
              <strong>Security:</strong> All permissions use Google's secure OAuth 2.0 protocol. 
              We only request the minimum access needed for each feature.
            </p>
            <p>
              <strong>Control:</strong> You can revoke any of these permissions at any time 
              through your Google Account settings at{' '}
              <a 
                href="https://myaccount.google.com/permissions" 
                target="_blank" 
                rel="noopener noreferrer"
                className="underline hover:text-blue-600"
              >
                myaccount.google.com/permissions
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeaturePreview({ scopeStatuses }: { scopeStatuses: Record<string, boolean> }) {
  return (
    <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
      <FeatureTile
        title="Gmail Integration"
        description="Read and search your emails, create smart filters, and get email notifications."
        icon={<Mail className="w-8 h-8 text-blue-600 mb-3" />}
        enabled={scopeStatuses.gmail}
      />
      <FeatureTile
        title="Drive Integration"
        description="Access and organize your files, collaborate on documents, and sync content."
        icon={<FileText className="w-8 h-8 text-green-600 mb-3" />}
        enabled={scopeStatuses.drive}
      />
      <FeatureTile
        title="Calendar Integration"
        description="View upcoming events, schedule meetings, and get calendar reminders."
        icon={<Calendar className="w-8 h-8 text-purple-600 mb-3" />}
        enabled={scopeStatuses.calendar}
      />
    </div>
  );
}

function FeatureTile({
  title,
  description,
  icon,
  enabled,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  enabled?: boolean;
}) {
  return (
    <div className="p-6 border border-gray-200 rounded-lg">
      {icon}
      <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
      {enabled && (
        <div className="mt-3 text-xs text-green-600 font-medium">
          ✓ Integration Active
        </div>
      )}
    </div>
  );
}
