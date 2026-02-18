'use server';

import { LinkMapDefinition } from '@nia/features/definitions';
import { Prism } from '@nia/prism';
import { revalidatePath } from 'next/cache';

export async function deleteLinkMap(id: string) {
    // TBD
}

export async function deleteLinkMapWithTenant(id: string, tenantId: string) {
  const prism = await Prism.getInstance();
  await prism.delete(LinkMapDefinition.dataModel.block, id, tenantId);
  revalidatePath('/dashboard/admin/link-map');
}
