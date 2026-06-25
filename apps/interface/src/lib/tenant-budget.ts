import crypto from 'crypto';
import { NextResponse } from 'next/server';

import redis from './redis';

type BudgetMode = 'off' | 'monitor' | 'enforce';

export interface TenantBudgetReservation {
  tenantId: string;
  surface: string;
  estimatedCents: number;
  usedCents: number;
  budgetCents: number;
  enforced: boolean;
}

export class TenantBudgetError extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(status: number, detail: string, headers: Record<string, string> = {}) {
    super(detail);
    this.name = 'TenantBudgetError';
    this.status = status;
    this.headers = headers;
  }

  toResponse(): NextResponse {
    return NextResponse.json({ error: this.message }, { status: this.status, headers: this.headers });
  }
}

function budgetMode(): BudgetMode {
  const mode = (process.env.PEARL_BUDGET_ENFORCEMENT || 'off').trim().toLowerCase();
  if (mode === 'monitor' || mode === 'enforce') return mode;
  return 'off';
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeEnvName(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function budgetCentsForTenant(tenantId: string): number {
  const specific = envInt(`PEARL_TENANT_DAILY_BUDGET_CENTS_${safeEnvName(tenantId)}`, -1);
  if (specific >= 0) return specific;
  return envInt('PEARL_TENANT_DAILY_BUDGET_CENTS_DEFAULT', 0);
}

export function estimateTenantBudgetCents(surface: string, fallback: number): number {
  return Math.max(0, envInt(`PEARL_BUDGET_ESTIMATE_CENTS_${safeEnvName(surface)}`, fallback));
}

function budgetKey(tenantId: string, surface: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  const tenantHash = crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 32);
  const surfaceHash = crypto.createHash('sha256').update(surface).digest('hex').slice(0, 16);
  return `pearl:budget:v1:${day}:${tenantHash}:${surfaceHash}`;
}

async function reserveInRedis(params: {
  key: string;
  amountCents: number;
  budgetCents: number;
  ttlSeconds: number;
}): Promise<{ allowed: boolean; usedCents: number }> {
  if (!redis) throw new Error('redis client is not configured');
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
  const result = await redis.eval(
    [
      "local current = tonumber(redis.call('GET', KEYS[1]) or '0')",
      'local amount = tonumber(ARGV[1])',
      'local budget = tonumber(ARGV[2])',
      'local ttl = tonumber(ARGV[3])',
      'if current + amount > budget then',
      '  return {0, current}',
      'end',
      'local updated = current + amount',
      "redis.call('SET', KEYS[1], tostring(updated), 'EX', ttl)",
      'return {1, updated}',
    ].join('\n'),
    1,
    params.key,
    String(params.amountCents),
    String(params.budgetCents),
    String(params.ttlSeconds),
  ) as [number | string, number | string];
  return {
    allowed: Number(result[0]) === 1,
    usedCents: Number(result[1]) || 0,
  };
}

export async function reserveTenantBudget(params: {
  tenantId: string;
  surface: string;
  estimatedCents: number;
}): Promise<TenantBudgetReservation | null> {
  const mode = budgetMode();
  if (mode === 'off') return null;

  const tenantId = params.tenantId.trim();
  const surface = params.surface.trim();
  const estimatedCents = Math.max(0, Math.ceil(params.estimatedCents));
  if (!tenantId || estimatedCents <= 0) return null;

  const budgetCents = budgetCentsForTenant(tenantId);
  if (budgetCents <= 0) {
    if (mode === 'enforce') {
      throw new TenantBudgetError(503, 'tenant budget is not configured');
    }
    return null;
  }

  try {
    const reservation = await reserveInRedis({
      key: budgetKey(tenantId, surface),
      amountCents: estimatedCents,
      budgetCents,
      ttlSeconds: 36 * 60 * 60,
    });
    if (!reservation.allowed) {
      if (mode === 'enforce') {
        throw new TenantBudgetError(402, 'tenant budget exceeded', {
          'X-Pearl-Budget-Remaining-Cents': String(Math.max(0, budgetCents - reservation.usedCents)),
          'X-Pearl-Budget-Limit-Cents': String(budgetCents),
        });
      }
      return {
        tenantId,
        surface,
        estimatedCents,
        usedCents: reservation.usedCents,
        budgetCents,
        enforced: false,
      };
    }
    return {
      tenantId,
      surface,
      estimatedCents,
      usedCents: reservation.usedCents,
      budgetCents,
      enforced: mode === 'enforce',
    };
  } catch (error) {
    if (error instanceof TenantBudgetError) throw error;
    if (mode === 'enforce') {
      throw new TenantBudgetError(503, 'tenant budget service unavailable');
    }
    return null;
  }
}
