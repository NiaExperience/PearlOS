import { NextRequest } from 'next/server';
import { POST_impl } from '@nia/prism/core/routes/users/invite/route';
import { dashboardAuthOptions } from '@dashboard/lib/auth-config';

export const dynamic = 'force-dynamic';

// Wrap core implementation to provide dashboard auth options
export async function POST(req: NextRequest) {
	return POST_impl(req, dashboardAuthOptions as any);
}
