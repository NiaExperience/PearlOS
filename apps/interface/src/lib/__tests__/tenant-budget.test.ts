const mockRedis = {
  status: 'ready',
  connect: jest.fn(),
  eval: jest.fn(),
};

jest.mock('../redis', () => ({
  __esModule: true,
  default: mockRedis,
}));

import {
  estimateTenantBudgetCents,
  reserveTenantBudget,
  TenantBudgetError,
} from '../tenant-budget';

describe('tenant budget guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.status = 'ready';
    process.env = {
      ...originalEnv,
      PEARL_BUDGET_ENFORCEMENT: 'off',
    };
    delete process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT;
    delete process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_TENANT_ALPHA;
    delete process.env.PEARL_BUDGET_ESTIMATE_CENTS_LAUNCHPAD_PLANNING;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('does not reserve when enforcement is off', async () => {
    const result = await reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 50,
    });

    expect(result).toBeNull();
    expect(mockRedis.eval).not.toHaveBeenCalled();
  });

  it('uses surface-specific estimate overrides', () => {
    process.env.PEARL_BUDGET_ESTIMATE_CENTS_LAUNCHPAD_PLANNING = '37';

    expect(estimateTenantBudgetCents('launchpad_planning', 100)).toBe(37);
  });

  it('enforces budget and hashes raw tenant values out of Redis keys', async () => {
    process.env.PEARL_BUDGET_ENFORCEMENT = 'enforce';
    process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT = '100';
    mockRedis.eval.mockResolvedValueOnce([1, 40]);

    const result = await reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 40,
    });

    expect(result).toEqual(expect.objectContaining({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 40,
      usedCents: 40,
      budgetCents: 100,
      enforced: true,
    }));
    const redisKey = String(mockRedis.eval.mock.calls[0][2]);
    expect(redisKey).not.toContain('tenant-alpha');
    expect(redisKey).not.toContain('launchpad_planning');
  });

  it('does not call connect while Redis is already connecting', async () => {
    process.env.PEARL_BUDGET_ENFORCEMENT = 'enforce';
    process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT = '100';
    mockRedis.status = 'connecting';
    mockRedis.eval.mockResolvedValueOnce([1, 20]);

    const result = await reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 20,
    });

    expect(result).toEqual(expect.objectContaining({
      usedCents: 20,
      enforced: true,
    }));
    expect(mockRedis.connect).not.toHaveBeenCalled();
  });

  it('throws 402 when enforce mode would exceed budget', async () => {
    process.env.PEARL_BUDGET_ENFORCEMENT = 'enforce';
    process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT = '100';
    mockRedis.eval.mockResolvedValueOnce([0, 90]);

    await expect(reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 20,
    })).rejects.toMatchObject({
      status: 402,
      message: 'tenant budget exceeded',
      headers: {
        'X-Pearl-Budget-Remaining-Cents': '10',
        'X-Pearl-Budget-Limit-Cents': '100',
      },
    });
  });

  it('throws 503 in enforce mode when budget config or Redis is unavailable', async () => {
    process.env.PEARL_BUDGET_ENFORCEMENT = 'enforce';

    await expect(reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 20,
    })).rejects.toBeInstanceOf(TenantBudgetError);

    process.env.PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT = '100';
    mockRedis.eval.mockRejectedValueOnce(new Error('redis down'));

    await expect(reserveTenantBudget({
      tenantId: 'tenant-alpha',
      surface: 'launchpad_planning',
      estimatedCents: 20,
    })).rejects.toMatchObject({
      status: 503,
      message: 'tenant budget service unavailable',
    });
  });
});
