# Frontend State Persistence Instructions

## Purpose
Guidelines for using localStorage and other persistence mechanisms in the Nia interface.

## When to Use localStorage

### Use localStorage for:
- ✅ User preferences (theme, layout settings)
- ✅ Queue/pending operations that survive page reload
- ✅ Client-side cache with expiration
- ✅ Feature flags or A/B test assignments
- ✅ Draft content (auto-save before submit)
- ✅ Recently accessed items (MRU lists)
- ✅ Onboarding completion state

### Don't use localStorage for:
- ❌ Sensitive data (tokens, passwords, PII)
- ❌ Large datasets (>5MB, use IndexedDB instead)
- ❌ Cross-tab real-time sync (use BroadcastChannel)
- ❌ Server-authoritative state (query server instead)
- ❌ Temporary UI state (use React state/context)

## Patterns

### 1. Queue with Expiration

**Use case**: User action queued for future event (e.g., activate note when call starts)

```typescript
// Writing queue item
interface QueuedItem {
  id: string;
  data: any;
  queuedAt: number;  // timestamp
  expiresIn: number; // milliseconds
}

const queueItem = (id: string, data: any, expiresIn: number = 180000) => {
  const item: QueuedItem = {
    id,
    data,
    queuedAt: Date.now(),
    expiresIn
  };
  localStorage.setItem('queuedItem', JSON.stringify(item));
};

// Reading with expiration check
const getQueuedItem = (): QueuedItem | null => {
  const stored = localStorage.getItem('queuedItem');
  if (!stored) return null;
  
  try {
    const item: QueuedItem = JSON.parse(stored);
    const age = Date.now() - item.queuedAt;
    
    if (age > item.expiresIn) {
      // Expired, clean up
      localStorage.removeItem('queuedItem');
      return null;
    }
    
    return item;
  } catch (error) {
    console.error('Failed to parse queued item:', error);
    localStorage.removeItem('queuedItem');
    return null;
  }
};

// Consuming (read + delete)
const consumeQueuedItem = (): QueuedItem | null => {
  const item = getQueuedItem();
  if (item) {
    localStorage.removeItem('queuedItem');
  }
  return item;
};
```

**Real example from this repo**:
- `apps/interface/src/features/DailyCall/components/Call.tsx` - Queue note for call activation
- Queue expires after 3 minutes
- Consumed when call starts

### 2. User Preferences

**Use case**: Settings that persist across sessions

```typescript
interface UserPreferences {
  theme: 'light' | 'dark';
  sidebarCollapsed: boolean;
  notificationSound: boolean;
  defaultView: string;
}

const PREFS_KEY = 'nia_user_prefs';
const DEFAULT_PREFS: UserPreferences = {
  theme: 'light',
  sidebarCollapsed: false,
  notificationSound: true,
  defaultView: 'dashboard'
};

// Read with defaults
const getPreferences = (): UserPreferences => {
  const stored = localStorage.getItem(PREFS_KEY);
  if (!stored) return DEFAULT_PREFS;
  
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(stored) };
  } catch {
    return DEFAULT_PREFS;
  }
};

// Update specific preference
const updatePreference = <K extends keyof UserPreferences>(
  key: K,
  value: UserPreferences[K]
) => {
  const prefs = getPreferences();
  prefs[key] = value;
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
};

// React hook
const usePreferences = () => {
  const [prefs, setPrefs] = useState<UserPreferences>(getPreferences);
  
  const updatePref = useCallback(<K extends keyof UserPreferences>(
    key: K,
    value: UserPreferences[K]
  ) => {
    updatePreference(key, value);
    setPrefs(prev => ({ ...prev, [key]: value }));
  }, []);
  
  return { preferences: prefs, updatePreference: updatePref };
};
```

### 3. Cache with Expiration

**Use case**: Cache API responses to reduce server load

```typescript
interface CachedData<T> {
  data: T;
  cachedAt: number;
  ttl: number; // time to live in ms
}

const setCache = <T>(key: string, data: T, ttl: number = 300000) => {
  const cached: CachedData<T> = {
    data,
    cachedAt: Date.now(),
    ttl
  };
  localStorage.setItem(`cache_${key}`, JSON.stringify(cached));
};

const getCache = <T>(key: string): T | null => {
  const stored = localStorage.getItem(`cache_${key}`);
  if (!stored) return null;
  
  try {
    const cached: CachedData<T> = JSON.parse(stored);
    const age = Date.now() - cached.cachedAt;
    
    if (age > cached.ttl) {
      localStorage.removeItem(`cache_${key}`);
      return null;
    }
    
    return cached.data;
  } catch {
    localStorage.removeItem(`cache_${key}`);
    return null;
  }
};

// Usage in async function
const fetchWithCache = async <T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 300000
): Promise<T> => {
  // Try cache first
  const cached = getCache<T>(key);
  if (cached) return cached;
  
  // Fetch and cache
  const data = await fetcher();
  setCache(key, data, ttl);
  return data;
};
```

### 4. Draft Auto-Save

**Use case**: Save form drafts to prevent data loss

```typescript
const DRAFT_KEY_PREFIX = 'draft_';

const saveDraft = (formId: string, data: Record<string, any>) => {
  const key = `${DRAFT_KEY_PREFIX}${formId}`;
  localStorage.setItem(key, JSON.stringify({
    data,
    savedAt: Date.now()
  }));
};

const getDraft = (formId: string): Record<string, any> | null => {
  const key = `${DRAFT_KEY_PREFIX}${formId}`;
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  
  try {
    const { data } = JSON.parse(stored);
    return data;
  } catch {
    return null;
  }
};

const clearDraft = (formId: string) => {
  const key = `${DRAFT_KEY_PREFIX}${formId}`;
  localStorage.removeItem(key);
};

// React hook with auto-save
const useDraftForm = <T extends Record<string, any>>(
  formId: string,
  initialValues: T
) => {
  const [values, setValues] = useState<T>(() => {
    const draft = getDraft(formId);
    return draft ? { ...initialValues, ...draft } : initialValues;
  });
  
  // Auto-save on change
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      saveDraft(formId, values);
    }, 1000); // Debounce 1 second
    
    return () => clearTimeout(timeoutId);
  }, [formId, values]);
  
  const submit = useCallback(() => {
    clearDraft(formId);
    // Submit logic here
  }, [formId]);
  
  return { values, setValues, submit };
};
```

### 5. Recently Accessed Items

**Use case**: MRU list for quick access

```typescript
const MRU_KEY = 'recently_accessed';
const MAX_MRU = 10;

interface MRUItem {
  id: string;
  title: string;
  accessedAt: number;
}

const addToMRU = (item: Omit<MRUItem, 'accessedAt'>) => {
  const stored = localStorage.getItem(MRU_KEY);
  let items: MRUItem[] = stored ? JSON.parse(stored) : [];
  
  // Remove if already exists
  items = items.filter(i => i.id !== item.id);
  
  // Add to front
  items.unshift({
    ...item,
    accessedAt: Date.now()
  });
  
  // Limit size
  items = items.slice(0, MAX_MRU);
  
  localStorage.setItem(MRU_KEY, JSON.stringify(items));
};

const getMRU = (): MRUItem[] => {
  const stored = localStorage.getItem(MRU_KEY);
  if (!stored) return [];
  
  try {
    return JSON.parse(stored);
  } catch {
    return [];
  }
};
```

## Best Practices

### 1. Always Handle Errors

```typescript
// Good - Try-catch with fallback
const getData = (): MyData | null => {
  try {
    const stored = localStorage.getItem('key');
    return stored ? JSON.parse(stored) : null;
  } catch (error) {
    console.error('localStorage error:', error);
    localStorage.removeItem('key'); // Clean up corrupted data
    return null;
  }
};

// Bad - No error handling
const getData = (): MyData => {
  return JSON.parse(localStorage.getItem('key')!);
};
```

**Why**: localStorage can throw QuotaExceededError, JSON.parse can fail, data can be corrupted

### 2. Use Namespaced Keys

```typescript
// Good - Namespaced
const KEYS = {
  USER_PREFS: 'nia_user_prefs',
  NOTE_QUEUE: 'nia_note_queue',
  DRAFT_PREFIX: 'nia_draft_'
};

// Bad - Generic keys (conflicts possible)
const KEYS = {
  PREFS: 'prefs',
  QUEUE: 'queue',
  DRAFT: 'draft'
};
```

**Why**: Avoids conflicts with other scripts, extensions, or future features

### 3. Version Your Schema

```typescript
interface VersionedData<T> {
  version: number;
  data: T;
}

const CURRENT_VERSION = 2;

const setVersionedData = <T>(key: string, data: T) => {
  const versioned: VersionedData<T> = {
    version: CURRENT_VERSION,
    data
  };
  localStorage.setItem(key, JSON.stringify(versioned));
};

const getVersionedData = <T>(key: string): T | null => {
  const stored = localStorage.getItem(key);
  if (!stored) return null;
  
  try {
    const versioned: VersionedData<T> = JSON.parse(stored);
    
    if (versioned.version !== CURRENT_VERSION) {
      // Migrate or discard
      console.warn(`Outdated data version: ${versioned.version}`);
      localStorage.removeItem(key);
      return null;
    }
    
    return versioned.data;
  } catch {
    return null;
  }
};
```

**Why**: Allows safe schema evolution without breaking existing data

### 4. Clean Up Old Data

```typescript
// Cleanup utility
const cleanupExpiredItems = () => {
  const now = Date.now();
  const keysToRemove: string[] = [];
  
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    
    if (key.startsWith('cache_') || key.startsWith('nia_queue_')) {
      try {
        const item = JSON.parse(localStorage.getItem(key)!);
        if (item.expiresAt && now > item.expiresAt) {
          keysToRemove.push(key);
        }
      } catch {
        keysToRemove.push(key); // Remove corrupted data
      }
    }
  }
  
  keysToRemove.forEach(key => localStorage.removeItem(key));
  console.log(`Cleaned up ${keysToRemove.length} expired items`);
};

// Run on app start
useEffect(() => {
  cleanupExpiredItems();
}, []);
```

### 5. Monitor Storage Quota

```typescript
const getStorageUsage = (): { used: number; available: number; percentage: number } | null => {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    return navigator.storage.estimate().then(estimate => ({
      used: estimate.usage || 0,
      available: estimate.quota || 0,
      percentage: ((estimate.usage || 0) / (estimate.quota || 1)) * 100
    }));
  }
  return null;
};

// Warn if approaching limit
const checkStorageQuota = async () => {
  const usage = await getStorageUsage();
  if (usage && usage.percentage > 80) {
    console.warn(`localStorage usage: ${usage.percentage.toFixed(1)}%`);
    // Trigger cleanup or notify user
  }
};
```

## Testing localStorage

### Unit Tests

```typescript
describe('localStorage utilities', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  
  it('should save and retrieve queued item', () => {
    queueItem('note-123', { title: 'Test' }, 60000);
    const item = getQueuedItem();
    
    expect(item).toMatchObject({
      id: 'note-123',
      data: { title: 'Test' }
    });
  });
  
  it('should return null for expired item', () => {
    queueItem('note-123', { title: 'Test' }, -1000); // Already expired
    const item = getQueuedItem();
    
    expect(item).toBeNull();
    expect(localStorage.getItem('queuedItem')).toBeNull(); // Cleaned up
  });
  
  it('should handle corrupted data gracefully', () => {
    localStorage.setItem('queuedItem', 'invalid json{');
    const item = getQueuedItem();
    
    expect(item).toBeNull();
    expect(localStorage.getItem('queuedItem')).toBeNull(); // Cleaned up
  });
});
```

### E2E Tests

```typescript
// Cypress test
it('should persist queued note across page reload', () => {
  cy.visit('/interface');
  cy.get('[data-testid="queue-note-button"]').click();
  
  // Reload page
  cy.reload();
  
  // Verify queue persisted
  cy.window().then(win => {
    const stored = win.localStorage.getItem('nia_note_queue');
    expect(stored).to.exist;
    const parsed = JSON.parse(stored);
    expect(parsed.id).to.equal('note-123');
  });
});
```

## Security Considerations

### Never Store Sensitive Data

```typescript
// ❌ NEVER DO THIS
localStorage.setItem('auth_token', token);
localStorage.setItem('user_password', password);
localStorage.setItem('api_key', apiKey);
localStorage.setItem('ssn', userSSN);

// ✅ Store only non-sensitive identifiers
localStorage.setItem('user_id', userId);
localStorage.setItem('session_id', sessionId); // If non-sensitive
```

**Why**: localStorage is accessible to any script on the domain (including XSS attacks)

### Validate Data from localStorage

```typescript
// Good - Validate before using
const getUserId = (): string | null => {
  const stored = localStorage.getItem('user_id');
  if (!stored) return null;
  
  // Validate format (UUID)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(stored)) {
    console.error('Invalid user_id format');
    localStorage.removeItem('user_id');
    return null;
  }
  
  return stored;
};
```

**Why**: Prevent code injection or unexpected behavior from tampered data

## Quality Checklist

Before completing features using localStorage:
- [ ] Keys are namespaced with project prefix
- [ ] Error handling with try-catch around JSON.parse
- [ ] Expiration logic for time-sensitive data
- [ ] Cleanup of expired/corrupted data
- [ ] No sensitive data stored
- [ ] Schema versioning for complex data structures
- [ ] Unit tests cover happy path + edge cases
- [ ] E2E tests verify persistence across page reloads
- [ ] TypeScript interfaces for stored data
- [ ] Documentation in feature README

## Related Documentation

- `docs/PIPECAT_NOTES_COLLABORATION.md` - Queue pattern example
- `apps/interface/src/features/*/README.md` - Feature-specific storage
- MDN localStorage: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
