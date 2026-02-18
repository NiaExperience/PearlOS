import { LinkMapDefinition } from '@nia/features/definitions';
import { Prism } from '@nia/prism';
import { format } from 'date-fns';


import { Button } from '@dashboard/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@dashboard/components/ui/table';

import { CopyLinkButton } from './CopyLinkButton';
import { deleteLinkMapWithTenant } from './actions';


export default async function LinkMapPage() {
  const prism = await Prism.getInstance();
  const result = await prism.query({
    contentType: LinkMapDefinition.dataModel.block,
    tenantId: 'any',
    limit: 100,
    sort: { createdAt: 'desc' }
  } as any);

  const items = result?.items || [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Link Map</h1>
      </div>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>JSON</TableHead>
              <TableHead>Tenant</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item: any) => (
              <TableRow key={item._id}>
                <TableCell>
                  <div className="flex items-center gap-2 font-mono">
                    {item.key || item.page_id}
                    <CopyLinkButton linkKey={item.key || item.page_id} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs max-w-[500px] truncate" title={item.json}>
                  {item.json}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{item.tenantId}</TableCell>
                <TableCell>{item.createdAt ? format(new Date(item.createdAt), 'PP p') : '-'}</TableCell>
                <TableCell>
                  <form action={deleteLinkMapWithTenant.bind(null, item._id, item.tenantId)}>
                    <Button variant="destructive" size="sm" type="submit">
                      Delete
                    </Button>
                  </form>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  No links found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
