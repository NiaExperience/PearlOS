import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

type EventDesc = { id: string; name: string; category?: string };

const root = join(__dirname, '..');
const descPath = join(root, 'descriptors', 'events.json');
const outDir = join(root, 'src', 'generated');
const pyPkgRoot = join(root, 'python', 'nia_events');

function toEnumKey(id: string): string {
    // Convert IDs like "bot.conversation.wrapup" -> "BOT_CONVERSATION_WRAPUP"
    return id
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/_{2,}/g, '_')
        .replace(/^_|_$/g, '')
        .toUpperCase();
}

function run() {
    const json = JSON.parse(readFileSync(descPath, 'utf-8')) as { events: EventDesc[] };
    mkdirSync(outDir, { recursive: true });

    const ids = json.events.map(e => e.id);
    const enumEntries = json.events.map(e => ({ key: toEnumKey(e.id), id: e.id }));

    // TypeScript output: enum + list using enum to avoid duplicating strings
    const ts = `/* eslint-env node */
// Auto-generated. Do not edit.
export enum EventEnum {
${enumEntries.map(e => `  ${e.key} = ${JSON.stringify(e.id)},`).join('\n')}
}

export const EventIds = [
${enumEntries.map(e => `  EventEnum.${e.key},`).join('\n')}
] as const;
export type EventId = typeof EventIds[number];
`;
    writeFileSync(join(outDir, 'events.ts'), ts, 'utf-8');

    // Python output: package with Enum and list
    mkdirSync(pyPkgRoot, { recursive: true });
    const pyInit = `# Auto-generated. Do not edit.\nfrom .events import EventId, EVENT_IDS\n\n__all__ = ['EventId', 'EVENT_IDS']\n`;
    writeFileSync(join(pyPkgRoot, '__init__.py'), pyInit, 'utf-8');

    const pyEnum = `# Auto-generated. Do not edit.\nfrom enum import Enum\n\nclass EventId(str, Enum):\n${enumEntries.map(e => `    ${e.key} = ${JSON.stringify(e.id)}`).join('\n')}\n\nEVENT_IDS = [\n${enumEntries.map(e => `    EventId.${e.key}.value,`).join('\n')}\n]\n`;
    writeFileSync(join(pyPkgRoot, 'events.py'), pyEnum, 'utf-8');
}

run();
