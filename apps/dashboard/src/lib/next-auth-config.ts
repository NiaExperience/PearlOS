import { createAuthConfig } from '@nia/prism/core/components/ui/next-auth-config';

// Create config for dashboard
// pull the port from the end of NEXTAUTH_DASHBOARD _URL
const port = parseInt(process.env.NEXTAUTH_DASHBOARD_URL?.split(':').pop() || '4000');
export const authConfig = createAuthConfig(port); 