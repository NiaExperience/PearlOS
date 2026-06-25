import { createHash, randomInt } from 'crypto';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';

export function generateDiscordCode(): string {
  let code = '';
  for (let i = 0; i < 3; i += 1) {
    code += LETTERS[randomInt(0, LETTERS.length)];
    code += DIGITS[randomInt(0, DIGITS.length)];
  }
  return code;
}

export function hashDiscordCode(rawCode: string): string {
  return createHash('sha256').update(rawCode.trim().toUpperCase()).digest('hex');
}
