import { envIsFeatureEnabled } from '@nia/features';
import { notFound } from 'next/navigation';
import SummonAiSpriteClient from './Client';

export default function SummonAiSpritePage() {
    if (!envIsFeatureEnabled('summonSpriteTool')) {
        notFound();
    }

    return <SummonAiSpriteClient />;
}

