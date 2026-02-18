// Type definitions for Express Request augmentation

export interface AuthContextUser {
  id: string;
  tenant: string;
  roles?: string[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: {
        serviceTrusted: boolean;
        botControlTrusted: boolean;
        user?: AuthContextUser;
      }
    }
  }
}

export {}; // This makes the file a module
