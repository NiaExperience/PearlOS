'use client';

export const dynamic = "force-dynamic";

import { DynamicContentListView } from '@nia/prism/core/components/DynamicContentListView';

export default function TestDynamicContentListView() {
  return (
    <div>
      <h1>Test DynamicContentListView</h1>
      <DynamicContentListView blockType="Exhibitor" assistantName="seatrade-jdx" />
    </div>
  );
} 