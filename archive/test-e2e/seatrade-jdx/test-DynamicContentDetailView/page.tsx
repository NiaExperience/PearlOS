'use client';

export const dynamic = "force-dynamic";

import { DynamicContentDetailView } from '@nia/prism/core/components/DynamicContentDetailView';

export default function TestDynamicContentDetailView() {
  return (
    <div>
      <h1>Test DynamicContentDetailView</h1>
      <DynamicContentDetailView blockType="Agenda" assistantName="seatrade-jdx" />
    </div>
  );
} 