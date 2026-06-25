import { envIsFeatureEnabled } from '@nia/features';
import { notFound } from 'next/navigation';
import SummonAiSpriteClient from './Client';

// Skip static prerendering — feature-gated and the inner client widget
// hits a Server Components error during SSG. Render on demand instead.
export const dynamic = 'force-dynamic';

export default function SummonAiSpritePage() {
    if (!envIsFeatureEnabled('summonSpriteTool')) {
        notFound();
    }

    return <SummonAiSpriteClient />;
}

