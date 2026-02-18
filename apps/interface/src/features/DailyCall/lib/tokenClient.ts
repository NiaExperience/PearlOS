const tokenCache = new Map<string, string>();

interface TokenResponse {
  token: string;
}

interface TokenRequestOptions {
  stealth?: boolean;
  displayName?: string;
}

function cacheKey(roomUrl: string, opts?: TokenRequestOptions): string {
  const mode = opts?.stealth ? 'stealth' : 'standard';
  const nameKey = opts?.displayName ? opts.displayName.trim().toLowerCase() : '';
  return `${roomUrl.trim().toLowerCase()}|${mode}|${nameKey}`;
}

export function clearTokenCache(): void {
  tokenCache.clear();
}

export async function requestDailyJoinToken(roomUrl: string, opts?: TokenRequestOptions): Promise<string> {
  const trimmedRoomUrl = roomUrl?.trim();
  const trimmedDisplayName = opts?.displayName?.trim();
  if (!trimmedRoomUrl) {
    throw new Error('roomUrl is required to request a Daily meeting token');
  }

  const key = cacheKey(trimmedRoomUrl, opts);
  const cached = tokenCache.get(key);
  if (cached) {
    return cached;
  }

  const response = await fetch('/api/dailyCall/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      roomUrl: trimmedRoomUrl,
      ...(opts?.stealth ? { stealth: true } : {}),
      ...(trimmedDisplayName ? { displayName: trimmedDisplayName } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to fetch Daily meeting token: ${response.status} ${detail}`);
  }

  const data = (await response.json()) as Partial<TokenResponse>;
  if (!data?.token) {
    throw new Error('Missing Daily meeting token in response');
  }

  tokenCache.set(key, data.token);
  return data.token;
}
