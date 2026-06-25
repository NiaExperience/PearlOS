const INTERNAL_PATH_PATTERN =
  /(?:file:\/\/)?\/(?:srv\/pearl-user-workspaces|workspace\/nia-universal|home\/deploy\/pearlos|opt\/pearlos|root\/\.openclaw)\/[^\s`'")<>]+/gi;

function basenameFromPath(value: string): string {
  const cleaned = value.replace(/^file:\/\//i, '').replace(/[.,);]+$/g, '');
  const parts = cleaned.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'the generated file';
}

export function sanitizeTaskResultForUser(value: unknown, limit = 1400): string {
  let text = String(value ?? '');
  if (!text.trim()) return '';

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, target: string) => {
    INTERNAL_PATH_PATTERN.lastIndex = 0;
    return INTERNAL_PATH_PATTERN.test(target) ? String(label).trim() : `[${label}](${target})`;
  });
  INTERNAL_PATH_PATTERN.lastIndex = 0;
  text = text.replace(INTERNAL_PATH_PATTERN, (match) => basenameFromPath(match));
  text = text.replace(/\b(?:disp|run|swarm|task|session)-[A-Za-z0-9_.:-]{8,}\b/gi, 'this task');
  text = text.replace(/\b[a-f0-9]{32,64}\b/gi, 'an internal reference');
  text = text.replace(/\b(?:DONE|BLOCKED)\s*:\s*/gi, '');
  text = text.replace(/^\s*(?:current host is|host:|pm2 cwd|workdir:|sandbox:|approval:|session id:)\b.*$/gim, '');
  text = text.replace(/^\s*(?:changed|changed files?|files changed|verification|verification run|build output|logs?|not deployed)\s*:\s*$/gim, '');
  text = text.replace(/^\s*[-*]\s*(?:apps|packages|scripts|docs|config|tests|public|\/workspace|\/home\/deploy|\/opt\/pearlos)\/[^\n]+$/gim, '');
  text = text.replace(/^\s*(?:PEARLOS_[A-Z0-9_]+|npm run|npx |pm2 |git |cp |curl |su - deploy|ssh )\b[^\n]*$/gim, '');
  text = text.replace(/```(?:json|bash|sh|text|log)?\s*[\s\S]{0,2000}?```/gi, (block) => {
    return /(tool_call|exec_command|traceback|npm |pm2 |codex|sandbox|\/workspace|\/opt\/pearlos)/i.test(block)
      ? ''
      : block;
  });
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...` : text;
}
