'use client';

import { IResourceShareToken } from '@nia/prism/core/blocks/resourceShareToken.block';
import { Loader2, Trash2, Ban } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@dashboard/components/ui/button';
import { Card, CardContent } from '@dashboard/components/ui/card';
import { useToast } from '@dashboard/hooks/use-toast';

interface EnrichedToken extends IResourceShareToken {
  creatorName?: string;
  resourceName?: string;
  redeemerNames?: string[];
}

export default function ResourceSharesPage() {
  const [tokens, setTokens] = useState<EnrichedToken[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchTokens = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/resource-shares');
      const data = await res.json();
      if (data.success) {
        setTokens(data.tokens);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTokens();
  }, []);

  const handleDeactivate = async (tokenId: string) => {
    if (!confirm('Are you sure you want to deactivate this token?')) return;
    try {
      const res = await fetch('/api/admin/resource-shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId })
      });
      if (res.ok) {
        fetchTokens();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (tokenId: string) => {
    if (!confirm('Are you sure you want to permanently delete this token? This action cannot be undone.')) return;
    try {
      const res = await fetch('/api/admin/resource-shares', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenId, hardDelete: true })
      });
      if (res.ok) {
        fetchTokens();
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold tracking-tight">Resource Shares</h1>
        <Button onClick={fetchTokens} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex justify-center p-4">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <div className="relative w-full overflow-auto">
              <table className="w-full caption-bottom text-sm">
                <thead className="[&_tr]:border-b">
                  <tr className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Token</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Resource Name</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Type</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Role</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Creator</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Redeemed By</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Expires</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Status</th>
                    <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {tokens.map((token) => (
                    <tr key={token._id} className="border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted">
                      <td className="p-4 align-middle font-mono text-xs">{token.token.substring(0, 8)}...</td>
                      <td className="p-4 align-middle font-medium">{token.resourceName || token.resourceId}</td>
                      <td className="p-4 align-middle">{token.resourceType}</td>
                      <td className="p-4 align-middle capitalize">{token.role}</td>
                      <td className="p-4 align-middle">{token.creatorName || token.createdBy}</td>
                      <td className="p-4 align-middle">
                        {token.redeemerNames && token.redeemerNames.length > 0 
                          ? (
                            <div className="flex flex-col gap-1">
                              {token.redeemerNames.map((name, i) => (
                                <span key={i} className="block whitespace-nowrap">{name}</span>
                              ))}
                            </div>
                          )
                          : <span className="text-muted-foreground italic">Pending</span>}
                      </td>
                      <td className="p-4 align-middle">{new Date(token.expiresAt).toLocaleString()}</td>
                      <td className="p-4 align-middle">
                        <div className="flex flex-col gap-1 items-start">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            token.isActive && new Date(token.expiresAt) > new Date() 
                              ? 'bg-green-100 text-green-800' 
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {token.isActive && new Date(token.expiresAt) > new Date() ? 'Active' : 'Inactive'}
                          </span>
                          {new Date(token.expiresAt) <= new Date() && (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800">
                              Expired
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 align-middle flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDeactivate(token._id!)}
                          disabled={!token.isActive}
                          className={token.isActive ? "text-orange-600 hover:text-orange-900 hover:bg-orange-50" : ""}
                          title={token.isActive ? "Deactivate Token" : "Token Inactive"}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => handleDelete(token._id!)}
                          className="text-red-600 hover:text-red-900 hover:bg-red-50"
                          title="Delete Token"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {tokens.length === 0 && (
                    <tr>
                      <td colSpan={9} className="p-4 text-center text-muted-foreground">No tokens found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
