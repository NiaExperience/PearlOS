'use client';

import type { IOrganization } from '@nia/prism/core/blocks/organization.block';
import { OrganizationRole } from '@nia/prism/core/blocks/userOrganizationRole.block';
import { Loader2, Trash2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { Button } from '@interface/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@interface/components/ui/dialog';
import { Input } from '@interface/components/ui/input';
import {
  getOrganizationMembers,
  removeUserFromSharing,
  shareResourceWithUser,
  updateUserRole,
} from '@interface/features/ResourceSharing/lib';
import { useToast } from '@interface/hooks/use-toast';
import { getClientLogger } from '@interface/lib/client-logger';

const log = getClientLogger('Notes');

interface NoteSharingModalProps {
  isOpen: boolean;
  onClose: () => void;
  organization: IOrganization;
  tenantId: string;
  currentUserId: string;
  resourceId: string;
  resourceTitle: string;
  onSharingUpdated?: () => void;
}

type AccessLevel = 'read-only' | 'read-write';

interface SharedUser {
  userId: string;
  email: string;
  role: OrganizationRole;
  displayRole: AccessLevel;
}

export default function NoteSharingModal({
  isOpen,
  onClose,
  organization,
  tenantId,
  currentUserId,
  resourceId,
  resourceTitle,
  onSharingUpdated,
}: NoteSharingModalProps) {
  const { toast } = useToast();
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<AccessLevel>('read-only');
  const [sharedUsers, setSharedUsers] = useState<SharedUser[]>([]);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [updatingRoleUserId, setUpdatingRoleUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !organization?._id) return;
    setIsLoadingMembers(true);
    setError(null);

    getOrganizationMembers(organization._id, currentUserId, tenantId)
      .then(members => {
        const mapped: SharedUser[] = members
          .filter(m => m.userId !== currentUserId)
          .map(m => ({
            userId: m.userId,
            email: m.email,
            role: m.role,
            displayRole: m.role === OrganizationRole.ADMIN ? 'read-write' : 'read-only',
          }));
        setSharedUsers(mapped);
      })
      .catch(err => {
        log.error('Failed to load shared users', { error: err, organizationId: organization._id, tenantId });
        setError('Failed to load shared users');
      })
      .finally(() => setIsLoadingMembers(false));
  }, [isOpen, organization?._id, currentUserId, tenantId]);

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleAddUser = async () => {
    setError(null);
    if (!newUserEmail.trim()) {
      setError('Please enter an email address');
      return;
    }
    if (!isValidEmail(newUserEmail)) {
      setError('Please enter a valid email address');
      return;
    }
    if (sharedUsers.some(u => u.email.toLowerCase() === newUserEmail.toLowerCase())) {
      setError('This user already has access to this note');
      return;
    }

    setIsAddingUser(true);
    try {
      const result = await shareResourceWithUser(
        resourceId,
        'Notes',
        newUserEmail,
        newUserRole,
        tenantId,
        currentUserId
      );

      const role = newUserRole === 'read-write' ? OrganizationRole.ADMIN : OrganizationRole.VIEWER;
      setSharedUsers(prev => [
        ...prev,
        {
          userId: result.user._id!,
          email: result.user.email!,
          role,
          displayRole: newUserRole,
        },
      ]);

      setNewUserEmail('');
      setNewUserRole('read-only');
      onSharingUpdated?.();
      toast({ title: 'User added', description: `${result.user.email} can access this note.` });
    } catch (err) {
      log.error('Error adding user to note sharing', {
        error: err,
        resourceId,
        resourceTitle,
        tenantId,
        newUserEmail,
        role: newUserRole,
      });
      setError('Failed to share with user');
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleRemoveUser = async (userId: string) => {
    setRemovingUserId(userId);
    try {
      await removeUserFromSharing(organization._id!, userId, tenantId);
      setSharedUsers(prev => prev.filter(u => u.userId !== userId));
      onSharingUpdated?.();
      toast({ title: 'Access removed', description: 'User no longer has access to this note.' });
    } catch (err) {
      log.error('Error removing user from sharing', { error: err, userId, resourceId });
      setError('Failed to remove user');
    } finally {
      setRemovingUserId(null);
    }
  };

  const handleRoleChange = async (userId: string, newRole: AccessLevel) => {
    setUpdatingRoleUserId(userId);
    try {
      await updateUserRole(
        organization._id!,
        userId,
        tenantId,
        newRole
      );
      setSharedUsers(prev =>
        prev.map(u =>
          u.userId === userId
            ? {
                ...u,
                role: newRole === 'read-write' ? OrganizationRole.ADMIN : OrganizationRole.VIEWER,
                displayRole: newRole,
              }
            : u
        )
      );
      onSharingUpdated?.();
      toast({ title: 'Access updated', description: 'User permissions updated.' });
    } catch (err) {
      log.error('Error updating sharing role', {
        error: err,
        userId,
        resourceId,
        role: newRole,
      });
      setError('Failed to update role');
    } finally {
      setUpdatingRoleUserId(null);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-lg font-semibold text-foreground">Share note</DialogTitle>
          <p className="text-sm text-muted-foreground">{resourceTitle}</p>
        </DialogHeader>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-foreground">Add user by email</label>
              <span className="text-xs text-muted-foreground">Set access before sharing</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                placeholder="user@example.com"
                value={newUserEmail}
                onChange={e => setNewUserEmail(e.target.value)}
                className="flex-1"
              />
              <select
                value={newUserRole}
                onChange={e => setNewUserRole(e.target.value as AccessLevel)}
                className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="read-only">Read-only</option>
                <option value="read-write">Read & Write</option>
              </select>
              <Button onClick={handleAddUser} disabled={isAddingUser} className="sm:w-auto">
                {isAddingUser ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Share'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">People with access</span>
              {isLoadingMembers && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {sharedUsers.length === 0 ? (
              <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                Only you can access this note.
              </p>
            ) : (
              <ul className="space-y-2">
                {sharedUsers.map(user => (
                  <li
                    key={user.userId}
                    className="flex flex-col gap-2 rounded-md border border-border/60 bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{user.email}</p>
                      <p className="text-xs text-muted-foreground">
                        Access: {user.displayRole === 'read-write' ? 'Read & Write' : 'Read-only'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={user.displayRole}
                        onChange={e => handleRoleChange(user.userId, e.target.value as AccessLevel)}
                        disabled={updatingRoleUserId === user.userId}
                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                        title="Change access level"
                      >
                        <option value="read-only">Read-only</option>
                        <option value="read-write">Read & Write</option>
                      </select>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveUser(user.userId)}
                        disabled={removingUserId === user.userId}
                        title="Remove access"
                        className="text-destructive"
                      >
                        {removingUserId === user.userId ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
