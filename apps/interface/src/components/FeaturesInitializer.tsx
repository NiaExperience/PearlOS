"use client";
import { FeatureKey, setAssistantSupportedFeatures } from '@nia/features';
import { useEffect } from 'react';

type Props = {
  features: FeatureKey[] | null | undefined;
  children?: React.ReactNode;
};

export default function FeaturesInitializer({ features, children }: Props) {
  useEffect(() => {
    setAssistantSupportedFeatures(features ?? null);
  }, [features]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return children as any || null;
}
