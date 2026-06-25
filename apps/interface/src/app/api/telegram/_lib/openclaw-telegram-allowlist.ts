import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || '/root/.openclaw/openclaw.json';
const execFileAsync = promisify(execFile);

async function restartOpenClawGateway(): Promise<void> {
  try {
    await execFileAsync('systemctl', ['--user', 'restart', 'openclaw-gateway.service'], {
      timeout: 15000,
    });
  } catch (error) {
    console.warn('[telegram/dm-link] OpenClaw gateway restart failed', error);
  }
}

export async function addTelegramUserToOpenClawAllowlist(telegramUserId: string): Promise<boolean> {
  if (!/^\d{5,}$/.test(telegramUserId)) return false;
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    parsed.channels = parsed.channels || {};
    parsed.channels.telegram = parsed.channels.telegram || {};
    parsed.channels.telegram.enabled = true;
    parsed.channels.telegram.dmPolicy = 'allowlist';
    const current = Array.isArray(parsed.channels.telegram.allowFrom)
      ? parsed.channels.telegram.allowFrom.map(String).filter((item: string) => item !== '*')
      : [];
    if (!current.includes(telegramUserId)) current.push(telegramUserId);
    parsed.channels.telegram.allowFrom = current;
    await fs.writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    await restartOpenClawGateway();
    return true;
  } catch (error) {
    console.warn('[telegram/dm-link] OpenClaw allowlist update failed', error);
    return false;
  }
}

export async function removeTelegramUserFromOpenClawAllowlist(telegramUserId: string): Promise<boolean> {
  if (!/^\d{5,}$/.test(telegramUserId)) return false;
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const telegram = parsed?.channels?.telegram;
    if (!telegram || !Array.isArray(telegram.allowFrom)) return false;
    telegram.allowFrom = telegram.allowFrom.map(String).filter((item: string) => item !== telegramUserId);
    telegram.dmPolicy = 'allowlist';
    await fs.writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    await restartOpenClawGateway();
    return true;
  } catch (error) {
    console.warn('[telegram/dm-link] OpenClaw allowlist removal failed', error);
    return false;
  }
}
