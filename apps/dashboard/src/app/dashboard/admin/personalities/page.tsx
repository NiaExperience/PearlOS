import React from 'react';
// Re-export client page to avoid TS resolution issues
import PersonalitiesAdminPage from './personalities_client';

export const dynamic = 'force-dynamic';

export default function PersonalitiesPage() {
  return <PersonalitiesAdminPage />;
}
