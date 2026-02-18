'use client';

import * as React from 'react';

import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInput,
} from './ui/sidebar';
import { AssistantBlock } from '@nia/prism/core/blocks';
import { useEffect, useState } from 'react';
type IAssistant = AssistantBlock.IAssistant;
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/utils';
import { Search, Plus, Building2, XCircle, ChevronsUpDown, Check } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover';
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './ui/command';
import { useCurrentRoles } from '../hooks/use-current-roles';
import { Dialog, DialogTrigger } from './ui/dialog';
import CreateAssistantModal from './create-assistant-modal';
import { Button } from './ui/button';
import Image from 'next/image';
import { useToast } from '../hooks/use-toast';

interface TenantLite { _id: string; name: string; }

interface AssistantSidebarProps { 
  assistants: IAssistant[]; 
  canManageTenants?: boolean;
  initialTenants?: Array<{_id: string; name: string}>;
}
export function AssistantSidebar({ assistants, canManageTenants, initialTenants = [] }: AssistantSidebarProps) {
  const pathname = usePathname();
  const [assistantsState, setAssistants] = React.useState(assistants);
  const [searchTerm, setSearchTerm] = React.useState('');
  
  // Initialize with server-provided tenants to avoid flash of "no tenant"
  const [tenantNames, setTenantNames] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    initialTenants.forEach(t => { if (t._id) map[t._id] = t.name; });
    return map;
  });
  const [allTenants, setAllTenants] = useState<Array<{_id:string; name:string}>>(initialTenants);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const { isTenantAdmin } = useCurrentRoles();
  const canEditTenants = canManageTenants ?? isTenantAdmin;
  const { toast } = useToast();

  // Fetch tenant list (names) to keep in sync (and refresh if needed)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tenants');
        if (!res.ok) return; // silent fail
        const data = await res.json();
  const map: Record<string, string> = {};
  const list: Array<{_id:string; name:string}> = [];
  (data.tenants || []).forEach((t: TenantLite) => { if (t._id) { map[t._id] = t.name; list.push({_id:t._id, name:t.name}); } });
  if (!cancelled) { setTenantNames(map); setAllTenants(list); }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const filteredAssistants = React.useMemo(() => {
    if (!searchTerm) return assistantsState;
    return assistantsState.filter((assistant) =>
      assistant.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      assistant.subDomain?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [assistantsState, searchTerm]);

  // Group assistants by tenant for better organization
  const assistantsByTenant = React.useMemo(() => {
    const grouped = filteredAssistants.reduce((acc, assistant) => {
      const tenantId = assistant.tenantId || 'unknown';
      if (!acc[tenantId]) {
        acc[tenantId] = [];
      }
      acc[tenantId].push(assistant);
      return acc;
    }, {} as Record<string, IAssistant[]>);
    return grouped;
  }, [filteredAssistants]);

  const totalAssistants = filteredAssistants.length;
  const tenantCount = Object.keys(assistantsByTenant).length;

  return (
    <aside className='hidden md:flex flex-col w-[350px] border-r bg-background sticky top-0 h-screen'>
      <div className='flex items-center justify-between p-4 border-b'>
        <div className='flex items-center gap-2'>
          <Image
            src='/Nia Logo 1.svg'
            alt='Nia Logo'
            width={32}
            height={32}
            className='rounded-lg'
          />
          <div className='flex flex-col'>
            <p className='font-bold'>NIA</p>
            <p className='text-xs text-muted-foreground'>
              {totalAssistants} assistants across {tenantCount} {tenantCount === 1 ? 'tenant' : 'tenants'}
            </p>
          </div>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button className='bg-gradient-to-r from-[#0097B2] to-[#003E49] hover:from-[#008299] hover:to-[#00313A] text-white'>
              <div className='flex items-center gap-2'>
                <span>Create Assistant</span>
                <Plus className='h-4 w-4' />
              </div>
            </Button>
          </DialogTrigger>
          <CreateAssistantModal />
        </Dialog>
      </div>
      <SidebarHeader className='gap-3 p-4'>
        <div className='relative'>
          <Search className='absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground' />
          <SidebarInput
            placeholder='Search assistants...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='pl-10'
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className='px-0'>
          <SidebarGroupContent>
            {filteredAssistants.map((assistant, index) => {
              const isActive = assistant._id ? pathname.includes(assistant._id) : false;
              // Use _id as key, fallback to index if _id is missing
              const key = assistant._id || `assistant-${index}`;
              return (
                <Link
                       href={`/dashboard/assistants/${assistant._id || assistant.subDomain || key}`}
                  key={key}
                  className={cn(
                    `flex flex-col items-start gap-1 whitespace-nowrap border-b p-3 text-sm leading-tight hover:bg-slate-50 dark:hover:bg-slate-800`,
                    isActive &&
                      'bg-cyan-50 dark:bg-cyan-900/50 border-l-4 border-l-cyan-500'
                  )}
                >
                  <div className='flex items-center gap-2 w-full'>
                    <div className='font-bold text-base flex-1'>
                      {assistant.name || 'Assistant title goes here'}
                    </div>
                    <Building2 className='h-3 w-3 text-muted-foreground' />
                  </div>
                  <p className='text-sm text-muted-foreground line-clamp-2'>
                    {assistant.firstMessage ||
                      'Euismod tincidunt nibh condimentum risus etiam tortor.'}
                  </p>
                  <div className='flex items-center gap-2 w-full'>
                    {assistant.subDomain && (
                      <span className='bg-blue-100 dark:bg-blue-900/50 rounded-md px-2 py-1 text-[10px] text-blue-700 dark:text-blue-300'>
                        {assistant.subDomain}
                      </span>
                    )}
                    <Popover open={assigningId === assistant._id} onOpenChange={(open)=> setAssigningId(open ? assistant._id! : null)}>
                      <PopoverTrigger asChild>
                        <button
                          type='button'
                          disabled={!canEditTenants}
                          className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] border transition',
                            assistant.tenantId && tenantNames[assistant.tenantId]
                              ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800 hover:bg-emerald-200/70'
                              : 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800 hover:bg-rose-200/70',
                            !isTenantAdmin && 'opacity-60 cursor-not-allowed'
                          )}
                          title={assistant.tenantId ? 'Change tenant' : 'Assign tenant'}
                        >
                          {assistant.tenantId && tenantNames[assistant.tenantId] ? (
                            <>
                              <Building2 className='h-3 w-3' /> {tenantNames[assistant.tenantId]}
                            </>
                          ) : (
                            <>
                              <XCircle className='h-3 w-3' /> no tenant
                            </>
                          )}
                          {canEditTenants && <ChevronsUpDown className='h-3 w-3 opacity-60' />}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className='p-0 w-48' align='start'>
                        <Command>
                          <CommandInput placeholder='Filter tenants...' className='h-7' />
                          <CommandList>
                            <CommandEmpty>No tenants.</CommandEmpty>
                            <CommandGroup heading='Tenants'>
                              {allTenants.map(t => (
                                <CommandItem
                                  key={t._id}
                                  value={t.name}
                                  onSelect={async () => {
                                    setAssigningId(null);
                                    if (!canEditTenants) return;
                                    try {
                                      const prevTenant = assistant.tenantId;
                                      setAssistants(prev => prev.map(a => a._id === assistant._id ? { ...a, tenantId: t._id } : a));
                                      const res = await fetch('/api/assistant/update', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ assistantId: assistant._id, tenantId: t._id }),
                                      });
                                      if (res.ok) {
                                        toast({ title: 'Tenant updated', description: `Assistant moved to ${t.name}` });
                                      } else {
                                        console.error('Failed to reassign tenant');
                                        setAssistants(prev => prev.map(a => a._id === assistant._id ? { ...a, tenantId: prevTenant } : a));
                                        toast({ title: 'Update failed', description: 'Could not change tenant', variant: 'destructive' });
                                      }
                                    } catch {/* ignore */}
                                  }}
                                >
                                  <Check className={cn('mr-2 h-3 w-3', assistant.tenantId === t._id ? 'opacity-100' : 'opacity-0')} />
                                  {t.name}
                                </CommandItem>
                              ))}
                              <CommandItem
                                value='no-tenant'
                                onSelect={async () => {
                                  setAssigningId(null);
                                  if (!canEditTenants) return;
                                  try {
                                    const prevTenant = assistant.tenantId;
                                    setAssistants(prev => prev.map(a => a._id === assistant._id ? { ...a, tenantId: '' as any } : a));
                                    const res = await fetch('/api/assistant/update', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ assistantId: assistant._id, tenantId: '' }),
                                    });
                                    if (res.ok) {
                                      toast({ title: 'Tenant unassigned', description: 'Assistant has no tenant' });
                                    } else {
                                      console.error('Failed to unassign tenant');
                                      setAssistants(prev => prev.map(a => a._id === assistant._id ? { ...a, tenantId: prevTenant } : a));
                                      toast({ title: 'Unassign failed', description: 'Could not remove tenant', variant: 'destructive' });
                                    }
                                  } catch {/* ignore */}
                                }}
                              >
                                <XCircle className='mr-2 h-3 w-3' /> Unassign
                              </CommandItem>
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    {/* Assistant id hidden per request
                    <span className='bg-gray-100 dark:bg-gray-700 rounded-md px-2 py-1 text-xs text-muted-foreground'>
                      id:{assistant._id}
                    </span>
                    */}
                  </div>
                </Link>
              );
            })}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </aside>
  );
}
