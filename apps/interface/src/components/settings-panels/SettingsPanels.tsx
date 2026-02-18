/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useState, useRef } from 'react';

import { AIConnectionsPanel } from '@interface/components/settings-panels/AIConnectionsPanel';
import { MetadataDisplay, type MetadataDisplayRef } from '@interface/components/settings-panels/MetadataDisplay';
import { useUserProfileMetadata } from '@interface/components/settings-panels/useUserProfileMetadata';
import { Avatar, AvatarFallback, AvatarImage } from '@interface/components/ui/avatar';
import { Button } from '@interface/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { Switch } from '@interface/components/ui/switch';
import { useResilientSession } from '@interface/hooks/use-resilient-session';
import { getClientLogger } from '@interface/lib/client-logger';
import { validateMetadata } from '@interface/lib/metadata-utils';

import '../../features/Notes/styles/notes.css';
import { NIA_EVENT_ONBOARDING_COMPLETE } from '../../features/DailyCall/events/niaEventRouter';

type PanelKey = 'ai-connections' | 'profile' | 'notifications' | 'appearance' | 'privacy' | 'contact' | 'stored-information' | null;

interface Props {
  initialOpenPanel?: PanelKey;
  tenantId?: string;
}

export default function SettingsPanels({ initialOpenPanel = null, tenantId }: Props) {
  const logger = getClientLogger('[settings_panels]');
  const { data: session } = useResilientSession();
  const [openPanel, setOpenPanel] = useState<PanelKey>(initialOpenPanel ?? null);
  const [isMobile, setIsMobile] = useState(false);

  const [notifications, setNotifications] = useState(true);
  const [emailUpdates, setEmailUpdates] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [contactPressed, setContactPressed] = useState(false);
  const [twoFAPressed, setTwoFAPressed] = useState(false);
  const [updatePwdPressed, setUpdatePwdPressed] = useState(false);
  const [exportPressed, setExportPressed] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingDots, setLoadingDots] = useState(1);

  const user = session?.user;
  const { metadata, userProfileId, loading: metadataLoading, error: metadataError, refresh: refreshMetadata, onboardingComplete } = useUserProfileMetadata(openPanel === 'stored-information', tenantId);
  const metadataDisplayRef = useRef<MetadataDisplayRef>(null);
  const userInitial = user?.name?.charAt(0) || user?.email?.charAt(0) || '?';

  // Track viewport for mobile/desktop layout
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 768);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Animate loading dots
  useEffect(() => {
    if (!metadataLoading) {
      setLoadingDots(1);
      return;
    }

    const interval = setInterval(() => {
      setLoadingDots((prev) => (prev >= 3 ? 1 : prev + 1));
    }, 500);

    return () => clearInterval(interval);
  }, [metadataLoading]);

  const navItems = [
    { key: 'ai-connections', label: 'AI & Connections', icon: (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="h-5 w-5" style={{ imageRendering: 'pixelated' }}>
        <rect x="7" y="2" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="1" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <rect x="13" y="12" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M10 8v2m0 0l-6 4m6-4l6 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ) },
    { key: 'profile', label: 'Profile', icon: <img src="/ProfileIco.png" alt="Profile" className="h-5 w-5" style={{ imageRendering: 'pixelated' }} /> },
    /*
    {
      key: 'notifications',
      label: 'Notifications',
      icon: <img src="/BellIco.png" alt="Notifications" className="h-5 w-5" style={{ imageRendering: 'pixelated' }} />,
    },
    {
      key: 'appearance',
      label: 'Appearance',
      icon: <img src="/ThemeIco.png" alt="Appearance" className="h-5 w-5" style={{ imageRendering: 'pixelated' }} />,
    },
    {
      key: 'privacy',
      label: 'Privacy & Security',
      icon: <img src="/sheildIcon.png" alt="Privacy" className="h-6 w-6" style={{ imageRendering: 'pixelated' }} />,
    },
    */
    { key: 'contact', label: 'Contact Us', icon: <img src="/EmailIcon.png" alt="Email" className="h-4 w-5" style={{ imageRendering: 'pixelated' }} /> },
    {
      key: 'stored-information',
      label: 'Stored Information',
      icon: <img src="/FolderIcon.png" alt="Stored Information" className="h-5 w-5" style={{ imageRendering: 'pixelated' }} />,
    },
  ];

  const renderPanel = () => {
    switch (openPanel) {
      case 'ai-connections':
        return <AIConnectionsPanel />;

      case 'profile':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Profile Information</CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Manage your personal information and account details
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6" style={{ fontFamily: 'Gohufont, monospace' }}>
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {user?.image ? (
                    <AvatarImage src={user.image} alt={user?.name || user?.email || ''} />
                  ) : null}
                  <AvatarFallback className="bg-gray-700 text-lg font-medium text-white" style={{ fontFamily: 'Gohufont, monospace' }}>
                    {userInitial}
                  </AvatarFallback>
                </Avatar>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>
                    Full Name
                  </Label>
                  <Input
                    id="name"
                    value={user?.name || ''}
                    readOnly
                    disabled
                    className="border-gray-700 bg-gray-800 text-white"
                    style={{ fontFamily: 'Gohufont, monospace' }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>
                    Email Address
                  </Label>
                  <Input
                    id="email"
                    type="email"
                    value={user?.email || ''}
                    readOnly
                    disabled
                    className="border-gray-700 bg-gray-800 text-white"
                    style={{ fontFamily: 'Gohufont, monospace' }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        );

      /*
      case 'notifications':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Notifications</CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Choose how you want to be notified about updates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Push Notifications</Label>
                  <p className="text-sm text-gray-500" style={{ fontFamily: 'Gohufont, monospace' }}>
                    Receive notifications about important updates
                  </p>
                </div>
                <Switch checked={notifications} onCheckedChange={setNotifications} />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Email Updates</Label>
                  <p className="text-sm text-gray-500" style={{ fontFamily: 'Gohufont, monospace' }}>Get updates via email about new features</p>
                </div>
                <Switch checked={emailUpdates} onCheckedChange={setEmailUpdates} />
              </div>
            </CardContent>
          </Card>
        );

      case 'appearance':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Appearance</CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Customize how the interface looks and feels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Dark Mode</Label>
                  <p className="text-sm text-gray-500" style={{ fontFamily: 'Gohufont, monospace' }}>Switch between light and dark themes</p>
                </div>
                <Switch checked={darkMode} onCheckedChange={setDarkMode} />
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Language</Label>
                <select className="w-full rounded-md border border-gray-600 bg-gray-700 p-2 text-white" style={{ fontFamily: 'Gohufont, monospace' }}>
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                </select>
              </div>
            </CardContent>
          </Card>
        );

      case 'privacy':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Privacy & Security</CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Manage your privacy settings and security preferences
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              <div className="space-y-2">
                <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Change Password</Label>
                <Button
                  onMouseDown={() => setUpdatePwdPressed(true)}
                  onMouseUp={() => setUpdatePwdPressed(false)}
                  onMouseLeave={() => setUpdatePwdPressed(false)}
                  className="flex items-center justify-center p-0 font-semibold text-white"
                  style={{
                    width: '120px',
                    height: '60px',
                    backgroundImage: `url(${updatePwdPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    imageRendering: 'pixelated',
                    border: '0',
                    boxShadow: 'none',
                    fontFamily: 'Gohufont, monospace',
                  }}
                >
                  Update Password
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Two-Factor Authentication</Label>
                <Button
                  onMouseDown={() => setTwoFAPressed(true)}
                  onMouseUp={() => setTwoFAPressed(false)}
                  onMouseLeave={() => setTwoFAPressed(false)}
                  className="flex items-center justify-center p-0 font-semibold text-white"
                  style={{
                    width: '120px',
                    height: '60px',
                    backgroundImage: `url(${twoFAPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    imageRendering: 'pixelated',
                    border: '0',
                    boxShadow: 'none',
                    fontFamily: 'Gohufont, monospace',
                  }}
                >
                  Enable 2FA
                </Button>
              </div>

              <div className="space-y-2">
                <Label className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Data Export</Label>
                <p className="text-sm text-gray-500" style={{ fontFamily: 'Gohufont, monospace' }}>Download a copy of your data</p>
                <Button
                  onMouseDown={() => setExportPressed(true)}
                  onMouseUp={() => setExportPressed(false)}
                  onMouseLeave={() => setExportPressed(false)}
                  className="flex items-center justify-center p-0 font-semibold text-white"
                  style={{
                    width: '120px',
                    height: '60px',
                    backgroundImage: `url(${exportPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    imageRendering: 'pixelated',
                    border: '0',
                    boxShadow: 'none',
                    fontFamily: 'Gohufont, monospace',
                  }}
                >
                  Export Data
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      */

      case 'contact':
        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-white" style={{ fontFamily: 'Gohufont, monospace' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/EmailIcon.png"
                  alt="Email"
                  className="shrink-0"
                  style={{ imageRendering: 'pixelated', width: '41px', height: '29px' }}
                />
                Contact Us
              </CardTitle>
              <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                Have a question or feedback? Email us at{' '}
                <span className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>dev@niaxp.com</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              <Button
                onClick={() => {
                  window.location.href = 'mailto:dev@niaxp.com';
                }}
                onMouseDown={() => setContactPressed(true)}
                onMouseUp={() => setContactPressed(false)}
                onMouseLeave={() => setContactPressed(false)}
                className="flex items-center justify-center p-0 font-semibold text-white"
                style={{
                  width: '144px',
                  height: '72px',
                  backgroundImage: `url(${contactPressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  imageRendering: 'pixelated',
                  border: '0',
                  boxShadow: 'none',
                  fontFamily: 'Gohufont, monospace',
                }}
              >
                Email Us
              </Button>
            </CardContent>
          </Card>
        );

      case 'stored-information': {
        const handleSaveMetadata = async () => {
          if (!userProfileId || !metadataDisplayRef.current) {
            return;
          }

          const currentMetadata = metadataDisplayRef.current.getCurrentMetadata();
          // Validate metadata before saving
          try {
            validateMetadata(currentMetadata);
          } catch (validationError: any) {
            alert(`Validation error: ${validationError.message}`);
            return;
          }

          setSaving(true);
          try {
            // Fetch the full UserProfile record first
            const fetchResponse = await fetch(`/api/userProfile?userId=${encodeURIComponent(user?.id || '')}`);
            if (!fetchResponse.ok) {
              throw new Error('Failed to fetch user profile');
            }
            const fetchData = await fetchResponse.json();
            const userProfile = fetchData.items?.[0];
            if (!userProfile) {
              throw new Error('User profile not found');
            }
            
            // Use PUT with REPLACE operation to completely replace metadata
            const response = await fetch('/api/userProfile', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                id: userProfileId,
                first_name: userProfile.first_name,
                email: userProfile.email,
                userId: userProfile.userId,
                metadata: currentMetadata,
                metadataOperation: 'replace',
              }),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Failed to save metadata');
            }

            // Refresh metadata after successful save
            await refreshMetadata();
            setIsEditMode(false);
          } catch (e: any) {
            logger.error('Failed to save metadata', {
              error: e instanceof Error ? e.message : String(e),
            });
            alert(`Failed to save metadata: ${e.message}`);
          } finally {
            setSaving(false);
          }
        };

        const handleToggleOnboarding = async (checked: boolean) => {
          if (!userProfileId) return;
          try {
            const response = await fetch('/api/userProfile', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: userProfileId,
                onboardingComplete: checked,
                metadataOperation: 'merge',
              }),
            });
            if (!response.ok) throw new Error('Failed to update onboarding status');
            await refreshMetadata();
            
            // Dispatch event to notify other components
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent(NIA_EVENT_ONBOARDING_COMPLETE, { 
                detail: { onboardingComplete: checked } 
              }));
            }
          } catch (e) {
            logger.error('Failed to update onboarding status', {
              error: e instanceof Error ? e.message : String(e),
            });
          }
        };

        return (
          <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Stored Information</CardTitle>
                  <CardDescription className="text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                    {isEditMode ? 'Edit metadata associated with your user profile' : 'View metadata associated with your user profile'}
                  </CardDescription>
                </div>
                {!metadataLoading && !metadataError && (
                  <div className="flex gap-2">
                    {!isEditMode ? (
                      <Button
                        onClick={() => setIsEditMode(true)}
                        size="sm"
                        className="bg-blue-600 hover:bg-blue-700 text-white"
                      >
                        Edit
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => setIsEditMode(false)}
                          size="sm"
                          variant="outline"
                          className="border-gray-600 text-gray-300 hover:bg-gray-700"
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                        <Button
                          onClick={handleSaveMetadata}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          disabled={saving}
                        >
                          {saving ? 'Saving...' : 'Save All'}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4" style={{ fontFamily: 'Gohufont, monospace' }}>
              {metadataLoading && (
                <div className="flex items-center justify-center py-8" style={{ fontFamily: 'Gohufont, monospace' }}>
                  <span className="text-blue-400 text-lg font-medium">
                    Loading{'.'.repeat(loadingDots)}
                  </span>
                </div>
              )}
              {metadataError && (
                <div className="rounded-md border border-red-600 bg-red-900/20 p-4 text-sm text-red-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                  Error: {metadataError}
                </div>
              )}
              {!metadataLoading && !metadataError && (
                <>
                  <div className="flex items-center justify-between rounded-lg border border-gray-700 bg-gray-900/50 p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base text-white" style={{ fontFamily: 'Gohufont, monospace' }}>Onboarding Completed</Label>
                      <p className="text-sm text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
                        Has the initial onboarding flow been completed?
                      </p>
                    </div>
                    <Switch
                      checked={onboardingComplete}
                      onCheckedChange={handleToggleOnboarding}
                      disabled={isEditMode}
                    />
                  </div>
                  {(metadata && Object.keys(metadata).length > 0) || isEditMode ? (
                    <MetadataDisplay
                      ref={metadataDisplayRef}
                      metadata={metadata || {}}
                      readOnly={!isEditMode}
                    />
                  ) : (
                    <div className="flex items-center justify-center py-8 text-gray-500" style={{ fontFamily: 'Gohufont, monospace' }}>
                      No stored information available
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );
      }

      default:
        return (
          <div className="flex h-[300px] items-center justify-center text-gray-400" style={{ fontFamily: 'Gohufont, monospace' }}>
            Select a section from the sidebar to view settings
          </div>
        );
    }
  };

  if (isMobile) {
    // Mobile: full-width menu on top, content below
    return (
      <div className="flex flex-col gap-3">
        <Card className={`border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
          <CardContent className="p-3">
            <div className="grid grid-cols-2 gap-2">
              {navItems.map(item => (
                <button
                  key={item.key}
                  onClick={() => setOpenPanel(openPanel === item.key ? null : (item.key as PanelKey))}
                  className={`flex items-center gap-2 rounded-lg px-3 py-3 text-left transition-colors
                    ${
                      openPanel === item.key
                        ? 'bg-gray-700 text-white'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  style={{ fontFamily: 'Gohufont, monospace' }}
                >
                  <span className="shrink-0">{item.icon}</span>
                  <span className="text-sm" style={{ fontFamily: 'Gohufont, monospace' }}>{item.label}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <div>{renderPanel()}</div>
      </div>
    );
  }

  // Desktop: sidebar + content
  return (
    <div className="flex gap-6">
      {/* Navigation Sidebar */}
      <Card className={`h-fit w-64 flex-shrink-0 border-gray-700 bg-gray-800 `} style={{ fontFamily: 'Gohufont, monospace' }}>
        <CardContent className="p-3">
          <div className="space-y-1">
            {navItems.map(item => (
              <button
                key={item.key}
                onClick={() => setOpenPanel(openPanel === item.key ? null : (item.key as PanelKey))}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
                  ${
                    openPanel === item.key
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`}
                style={{ fontFamily: 'Gohufont, monospace' }}
              >
                {item.icon}
                <span style={{ fontFamily: 'Gohufont, monospace' }}>{item.label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Content Area */}
      <div className="flex-1">{renderPanel()}</div>
    </div>
  );
}

export { SettingsPanels };
