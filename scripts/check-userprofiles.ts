#!/usr/bin/env tsx
/**
 * Quick script to check UserProfile voice configs
 */

import { Prism } from '@nia/prism';

async function main() {
  const prism = await Prism.getInstance();
  const result = await prism.query({
    contentType: 'UserProfile',
    tenantId: 'any',
    where: { type: { eq: 'UserProfile' } },
    limit: 100,
  } as any);

  console.log(`Found ${result.total} UserProfile records\n`);

  if (!result.items || result.items.length === 0) {
    console.log('No profiles found.');
    return;
  }

  const withConfig = result.items.filter((item: any) => item.personalityVoiceConfig);
  const withoutConfig = result.items.length - withConfig.length;

  console.log(`Profiles with voice config: ${withConfig.length}`);
  console.log(`Profiles without voice config: ${withoutConfig}\n`);

  if (withConfig.length > 0) {
    console.log('Voice configs:');
    withConfig.slice(0, 10).forEach((item: any) => {
      const pvc = item.personalityVoiceConfig;
      const email = item.email || 'no-email';
      const provider = pvc.voiceProvider || 'none';
      const voiceId = pvc.voiceId || 'none';
      console.log(`  ${email}: provider=${provider}, voiceId=${voiceId}`);
    });
  }
}

main().catch(console.error);

