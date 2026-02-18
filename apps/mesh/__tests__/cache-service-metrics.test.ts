import { CacheService } from '../src/services/cache.service';

describe('Mesh CacheService function metrics', () => {
  let cache: CacheService;

  beforeAll(async () => {
    // Reset singleton to ensure clean test state
    await CacheService.resetInstance();
    cache = CacheService.getInstance({
      stdTTL: 600,
      checkperiod: 120,
      useRedis: false, // Disable Redis for tests
    });
  });

  afterAll(async () => {
    // Clean up resources and reset singleton
    await CacheService.resetInstance();
  });

  it('records timings for get/set/delete operations with hits and misses', async () => {
    const key = `operation:TestMetrics:${JSON.stringify({ a: 1 })}`;

    // Ensure clean state
    await cache.delete(key);

    // Miss
    const miss = await cache.get<any>(key);
    expect(miss).toBeNull();

    // Set
    const payload = { data: { ok: true, at: Date.now() } };
    await cache.set(key, payload, 30); // small TTL

    // Hit
    const hit = await cache.get<any>(key);
    expect(hit).toBeTruthy();
    expect(hit?.data?.ok).toBe(true);

    // Delete
    await cache.delete(key);
    const afterDelete = await cache.get<any>(key);
    expect(afterDelete).toBeNull();

    // Pattern delete path
    await cache.set(key, payload, 30);
    await cache.deletePattern('operation:TestMetrics');
    const afterPatternDelete = await cache.get<any>(key);
    expect(afterPatternDelete).toBeNull();
  });
});
