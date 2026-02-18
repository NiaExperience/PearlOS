'use client';

import { X } from 'lucide-react';
import { useState } from 'react';
import { usePostHog } from 'posthog-js/react';

import { Button } from '@interface/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@interface/components/ui/card';
import { Input } from '@interface/components/ui/input';
import { Label } from '@interface/components/ui/label';
import { isFeatureEnabled } from '@nia/features';

interface InviteViaEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  supportedFeatures?: string[];
}

export function InviteViaEmailModal({ isOpen, onClose, supportedFeatures }: InviteViaEmailModalProps) {
  const posthog = usePostHog();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'error' | 'success'; message: string } | null>(null);

  if (!isOpen) return null;
  if (!isFeatureEnabled('resourceSharing', supportedFeatures)) return null;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice(null);
    if (!email.trim()) {
      setNotice({ kind: 'error', message: 'Email is required.' });
      return;
    }
    // Basic email check
    const emailOk = /.+@.+\..+/.test(email.trim());
    if (!emailOk) {
      setNotice({ kind: 'error', message: 'Please enter a valid email address.' });
      return;
    }
    try {
      setSending(true);
      // Call AWS SES API to send invitation email
      const response = await fetch('/api/invite-friend', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invitation');
      }

      setNotice({ kind: 'success', message: data.message || `Invitation sent to ${email.trim()}` });
      posthog?.capture('invite_sent', { email_domain: email.split('@')[1] });
      setEmail('');
      // Keep modal open to display success inline per request
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to send. Please try again later.';
      setNotice({ kind: 'error', message: errorMessage });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[650] flex items-start justify-center p-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg my-12 z-[700]">
        <Card className="bg-gray-900 border-gray-700 shadow-2xl" style={{ fontFamily: 'Gohufont, monospace' }}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="flex items-center gap-3">
              {/* Email icon image */}
              <img
                src="/EmailIcon.png"
                alt="Email"
                className="shrink-0"
                style={{
                  imageRendering: 'pixelated',
                  width: '41px',
                  height: '29px',
                }}
              />
              <CardTitle className="text-2xl text-white" style={{ fontFamily: 'Gohufont, monospace', fontWeight: 'normal', letterSpacing: '-0.5px' }}>Invite a Friend</CardTitle>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose} 
              className="text-gray-400 hover:text-white hover:bg-gray-800"
              style={{ fontFamily: 'Gohufont, monospace' }}
            >
              <X className="h-5 w-5" />
            </Button>
          </CardHeader>

          <CardContent style={{ fontFamily: 'Gohufont, monospace' }}>
            <form onSubmit={onSubmit} className="space-y-4">
              {notice && (
                <div
                  role="status"
                  className={`rounded-md px-3 py-2 text-sm ${notice.kind === 'error' ? 'bg-red-900/40 text-red-200 border-red-700' : 'bg-emerald-900/40 text-emerald-200 border-emerald-700'} border`}
                  style={{
                    imageRendering: 'pixelated',
                    boxShadow: notice.kind === 'error' ? '0 0 0 2px #7f1d1d, 2px 2px 0 #3f0f0f' : '0 0 0 2px #064e3b, 2px 2px 0 #052e1a',
                    fontFamily: 'Gohufont, monospace',
                  }}
                >
                  {notice.message}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="invite-email" className="text-gray-300" style={{ fontFamily: 'Gohufont, monospace' }}>Friend's email</Label>
                <Input
                  id="invite-email"
                  type="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-gray-800 border-gray-700 text-white placeholder-gray-500"
                  style={{ fontFamily: 'Gohufont, monospace' }}
                />
              </div>

              <Button
                type="submit"
                disabled={sending}
                onMouseDown={() => setPressed(true)}
                onMouseUp={() => setPressed(false)}
                onMouseLeave={() => setPressed(false)}
                className="text-white font-semibold p-0 flex items-center justify-center mx-auto"
                style={{
                  width: '144px', // 36x18 image scaled by 4x → keeps 2:1 ratio
                  height: '72px',
                  backgroundImage: `url(${pressed ? '/GreenButtonDown.png' : '/GreenButtonUp.png'})`,
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '100% 100%',
                  backgroundPosition: 'center',
                  imageRendering: 'pixelated',
                  border: '0',
                  boxShadow: 'none',
                  fontFamily: 'Gohufont, monospace',
                }}
              >
                {sending ? 'Sending…' : 'Send Invite'}
              </Button>

              {/* Removed horizontal stripe per request */}
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


