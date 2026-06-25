export type VisualTaskStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled"
  | "archived"
  | string;

export interface VisualTask {
  id: string;
  title: string;
  description?: string;
  status: VisualTaskStatus;
  source?: string;
  assignee?: string;
  kind?: string;
  createdAt?: string;
  updatedAt?: string;
  agents?: string[];
  swarmCategory?: string;
  notes?: Array<{ ts?: string; text?: string; kind?: string }>;
  agentActivity?: Record<string, { status?: string; thought?: string; updatedAt?: string }>;
  result?: string | null;
}

export interface VisualRoom {
  id: string;
  name: string;
  detail: string;
  status: "active" | "recent" | "available";
}
