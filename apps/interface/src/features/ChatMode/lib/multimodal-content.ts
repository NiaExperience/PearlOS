export type ChatTextPart = {
  type: 'text';
  text: string;
};

export type ChatImagePart = {
  type: 'image_url';
  image_url: {
    url: string;
  };
};

export type ChatApiContent = string | Array<ChatTextPart | ChatImagePart>;

export type ChatApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: ChatApiContent;
};

export function buildUserTurnContent(text: string, imageDataUrl?: string): ChatApiContent {
  const trimmed = text.trim();
  if (!imageDataUrl) return trimmed;
  return [
    ...(trimmed ? [{ type: 'text' as const, text: trimmed }] : []),
    { type: 'image_url' as const, image_url: { url: imageDataUrl } },
  ];
}

export function chatMessageContentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text || '');
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content || '');
}
