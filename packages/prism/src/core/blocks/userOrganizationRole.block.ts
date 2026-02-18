export const BlockType_UserOrganizationRole = 'UserOrganizationRole';

export enum OrganizationRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export interface IUserOrganizationRole {
  _id?: string;
  userId: string; // References user page_id
  organizationId: string; // References organization page_id
  role: OrganizationRole;
}
