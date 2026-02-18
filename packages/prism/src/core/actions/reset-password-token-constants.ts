// Shared constants & types for reset password token actions (non server-only)
export const BlockType_ResetPasswordToken = 'ResetPasswordToken';
export interface IResetPasswordToken {
  _id?: string; // platform page id
  tokenHash: string;
  userId: string;
  email?: string;
  issuedAt?: string; // ISO timestamp
  expiresAt: string; // ISO timestamp
  consumedAt?: string | null; // null until used
  purpose: 'password_reset' | 'invite_activation';
  attempts?: number; // failed / reuse attempts
  ipIssued?: string;
  uaIssued?: string;
}
