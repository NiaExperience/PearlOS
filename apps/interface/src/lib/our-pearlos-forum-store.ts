import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

export interface ForumReply {
  id: string;
  topicId: string;
  body: string;
  authorLabel: string;
  createdAt: number;
}

export interface ForumTopic {
  id: string;
  title: string;
  body: string;
  authorLabel: string;
  createdAt: number;
  updatedAt: number;
  replyCount: number;
  lastReplyAt: number;
  replies: ForumReply[];
}

interface ForumTopicRecord {
  id: string;
  title: string;
  body: string;
  authorLabel: string;
  createdAt: number;
  updatedAt: number;
}

interface ForumReplyRecord {
  id: string;
  topicId: string;
  body: string;
  authorLabel: string;
  createdAt: number;
}

export const FORUM_MAX_TOPICS = 200;
export const FORUM_MAX_REPLIES = 1200;
const FORUM_MAX_REPLIES_PER_TOPIC = 80;

function forumFile(): string {
  return process.env.PEARL_OUR_PEARLOS_FORUM_FILE || path.join(process.cwd(), '.data', 'our-pearlos-forum.json');
}

function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/[<>]/g, '').replace(/\s+/g, ' ').slice(0, limit)
    : '';
}

function safeId(value: unknown): string {
  return cleanText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 96);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeTopic(raw: unknown, now: number): ForumTopicRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = safeId(input.id);
  const title = cleanText(input.title, 120);
  const body = cleanText(input.body, 1600);
  const authorLabel = cleanText(input.authorLabel, 80);
  if (!id || !title || !body || !authorLabel) return null;
  const createdAt = asNumber(input.createdAt, now);
  return {
    id,
    title,
    body,
    authorLabel,
    createdAt,
    updatedAt: asNumber(input.updatedAt, createdAt),
  };
}

function normalizeReply(raw: unknown, now: number): ForumReplyRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  const id = safeId(input.id);
  const topicId = safeId(input.topicId);
  const body = cleanText(input.body, 1200);
  const authorLabel = cleanText(input.authorLabel, 80);
  if (!id || !topicId || !body || !authorLabel) return null;
  return {
    id,
    topicId,
    body,
    authorLabel,
    createdAt: asNumber(input.createdAt, now),
  };
}

function normalizeForum(raw: unknown, now: number): { topics: ForumTopicRecord[]; replies: ForumReplyRecord[] } {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const topics = Array.isArray(input.topics)
    ? input.topics.map((item) => normalizeTopic(item, now)).filter(Boolean) as ForumTopicRecord[]
    : [];
  const topicIds = new Set(topics.map((topic) => topic.id));
  const replies = Array.isArray(input.replies)
    ? input.replies
        .map((item) => normalizeReply(item, now))
        .filter((reply): reply is ForumReplyRecord => Boolean(reply && topicIds.has(reply.topicId)))
    : [];
  return {
    topics: topics.slice(0, FORUM_MAX_TOPICS),
    replies: replies.slice(0, FORUM_MAX_REPLIES),
  };
}

function toPublicTopics(topics: ForumTopicRecord[], replies: ForumReplyRecord[]): ForumTopic[] {
  return topics
    .map((topic) => {
      const topicReplies = replies
        .filter((reply) => reply.topicId === topic.id)
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(-FORUM_MAX_REPLIES_PER_TOPIC);
      const lastReplyAt = topicReplies.at(-1)?.createdAt ?? topic.updatedAt;
      return {
        ...topic,
        replyCount: topicReplies.length,
        lastReplyAt,
        replies: topicReplies,
      };
    })
    .sort((a, b) => b.lastReplyAt - a.lastReplyAt || b.createdAt - a.createdAt);
}

async function readRawForum(): Promise<{ topics: ForumTopicRecord[]; replies: ForumReplyRecord[] }> {
  try {
    const raw = await fs.readFile(forumFile(), 'utf-8');
    return normalizeForum(JSON.parse(raw), Date.now());
  } catch {
    return { topics: [], replies: [] };
  }
}

async function writeRawForum(forum: { topics: ForumTopicRecord[]; replies: ForumReplyRecord[] }): Promise<void> {
  const file = forumFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(forum, null, 2), 'utf-8');
}

export async function readForumTopics(): Promise<ForumTopic[]> {
  const forum = await readRawForum();
  return toPublicTopics(forum.topics, forum.replies);
}

export async function addForumTopic(input: { title: string; body: string; authorLabel: string }): Promise<ForumTopic | null> {
  const title = cleanText(input.title, 120);
  const body = cleanText(input.body, 1600);
  const authorLabel = cleanText(input.authorLabel, 80);
  if (!title || !body || !authorLabel) return null;
  const forum = await readRawForum();
  const now = Date.now();
  const topic: ForumTopicRecord = {
    id: `topic-${randomUUID().slice(0, 12)}`,
    title,
    body,
    authorLabel,
    createdAt: now,
    updatedAt: now,
  };
  const topics = [topic, ...forum.topics].slice(0, FORUM_MAX_TOPICS);
  await writeRawForum({ topics, replies: forum.replies });
  return toPublicTopics(topics, forum.replies).find((entry) => entry.id === topic.id) ?? null;
}

export async function addForumReply(input: { topicId: string; body: string; authorLabel: string }): Promise<ForumTopic | null> {
  const topicId = safeId(input.topicId);
  const body = cleanText(input.body, 1200);
  const authorLabel = cleanText(input.authorLabel, 80);
  if (!topicId || !body || !authorLabel) return null;
  const forum = await readRawForum();
  const now = Date.now();
  const topic = forum.topics.find((entry) => entry.id === topicId);
  if (!topic) return null;
  const reply: ForumReplyRecord = {
    id: `reply-${randomUUID().slice(0, 12)}`,
    topicId,
    body,
    authorLabel,
    createdAt: now,
  };
  topic.updatedAt = now;
  const replies = [...forum.replies, reply].slice(-FORUM_MAX_REPLIES);
  await writeRawForum({ topics: forum.topics, replies });
  return toPublicTopics(forum.topics, replies).find((entry) => entry.id === topic.id) ?? null;
}
