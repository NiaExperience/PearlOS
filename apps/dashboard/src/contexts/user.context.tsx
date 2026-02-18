'use client';

import { createContext, useContext, useEffect, useState } from 'react';
// Removed server-only imports
// import { UserBlock } from '@nia/prism/core/blocks';
// import { UserActions } from '@nia/prism/core/actions';

// Define a minimal user type inline
interface IUser {
  _id?: string;
  name: string;
  email: string;
  // Add other fields as needed
}

interface UserContextType {
  user: IUser | null;
  loading: boolean;
  error: string | null;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  loading: true,
  error: null,
  refreshUser: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<IUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshUser = async () => {
    try {
      setLoading(true);
  // NOTE: Corrected path: existing API route is /api/users/me (plural)
  const response = await fetch('/api/users/me');
      if (response.ok) {
        const data = await response.json();
        setUser(data.user ?? null);
        setError(null);
      } else {
        const data = await response.json();
        setUser(null);
        setError(data?.error || 'Failed to fetch user data');
      }
    } catch (err) {
      setUser(null);
      setError('Failed to fetch user data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  return (
    <UserContext.Provider value={{ user, loading, error, refreshUser }}>
      {children}
    </UserContext.Provider>
  );
}

export const useUser = () => useContext(UserContext);