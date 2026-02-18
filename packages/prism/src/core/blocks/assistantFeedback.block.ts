
import { z } from 'zod';

export const BlockType_AssistantFeedback = 'AssistantFeedback';

// Add the FeedbackType enum
export enum FeedbackType {
    MISTAKE = 'mistake',
    IMPROVEMENT = 'improvement',
    BUG = 'bug',
    OTHER = 'other',
};

// Add the status type
export enum StatusType {
  NEW = 'new',
  UNDER_REVIEW = 'under_review', 
  RESOLVED = 'resolved', 
  WONT_FIX = 'wont_fix'
};

// Add the severity type
export enum SeverityType {
  LOW = 'low', 
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface IAssistantFeedback {
  _id?: string;
  assistant_id: string;
  call_id: string;
  description: string;
  feedback_type?: FeedbackType;
  conversation_context?: string;
  reported_by?: string;
  reported_at?: string; 
  status?: StatusType;
  resolution_notes?:  string;
  severity?: SeverityType;
};

const AssistantFeedbackDefaults = {
  feedback_type: FeedbackType.MISTAKE,
  reported_at: new Date().toISOString(),
  status: StatusType.NEW,
  severity: SeverityType.MEDIUM,
};
