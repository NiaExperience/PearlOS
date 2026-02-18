import { createAuthConfig } from '@nia/prism/core/components/ui/next-auth-config';

// Create config for interface
// pull the port from the end of NEXTAUTH_INTERFACE_URL
const port = parseInt(process.env.NEXTAUTH_INTERFACE_URL?.split(':').pop() || '3000');
export const authConfig = createAuthConfig(port); 