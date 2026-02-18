import { DELETE_impl } from '@nia/prism/core/routes/admin/token/[id]/route';
import { dashboardAuthOptions } from '../../../../../lib/auth-config';

export async function DELETE(req: Request, ctx: { params: { id: string } }) {
  return DELETE_impl(req as any, ctx as any, dashboardAuthOptions as any);
}
