import { IUserMessageStore } from './user.block';

export const BlockType = 'AnonymousUser';

// IUserMessageStore holds the message store structure(s) for any user type
export interface IAnonymousUser extends IUserMessageStore {
  _id?: string;
  sessionId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>;
}