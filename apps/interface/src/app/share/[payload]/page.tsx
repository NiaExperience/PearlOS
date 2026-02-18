import { getLinkMapByKey } from '@interface/features/ResourceSharing/actions/linkmap-actions';
import { getLogger } from '@interface/lib/logger';

import { ShareRedemptionClient } from './client';

export default async function ShareRedemptionPage({ 
  params
}: { 
  params: Promise<{ payload: string }>,
}) {
  const log = getLogger('ShareRedemption');
  const { payload } = await params;
  
  let sharePayload;

  // Try to resolve as a short link first
  // Short links are typically short (e.g. 12 chars), while base64 encoded JSON is much longer.
  if (payload.length < 50) {
    try {
      const linkMap = await getLinkMapByKey(payload);
      if (linkMap && linkMap.json) {
        try {
          sharePayload = JSON.parse(linkMap.json);
        } catch {
          log.warn('Failed to parse LinkMap json', { payloadKey: payload });
        }
      }
    } catch (e) {
      log.warn('Failed to resolve short link', { error: e, payloadKey: payload });
    }
  }

  // Fallback to legacy base64 decoding if not found or long payload
  if (!sharePayload) {
    try {
      const payloadString = Buffer.from(payload, 'base64url').toString('utf-8');
      sharePayload = JSON.parse(payloadString);
    } catch (e) {
      log.error('Failed to decode share payload', { error: e, payloadLength: payload?.length });
      // Let the client handle the error or show a 404
      return <div>Invalid Share Link</div>;
    }
  }

  const { token, resourceId, contentType, mode, assistantName } = sharePayload;
  const isPearlosOnly = (process.env.PEARLOS_ONLY ?? '').toLowerCase() === 'true';

  return (
    <ShareRedemptionClient 
      token={token}
      resourceId={resourceId}
      contentType={contentType}
      mode={mode}
      assistantName={assistantName}
      isPearlosOnly={isPearlosOnly}
    />
  );
}

export const dynamic = "force-dynamic";
