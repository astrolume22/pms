// Hand-curated Supabase types for Phase 1 tables.
// Regenerate with `supabase gen types typescript` once the CLI is wired up.

export type UserRole = 'admin' | 'manager' | 'viewer';
export type UserStatus = 'active' | 'deactivated';
export type ThemePref = 'light' | 'dark';

export interface UserRow {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  is_super_admin: boolean;
  theme: ThemePref;
  timezone: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  icon_emoji: string;
  icon_color: string;
  is_main: boolean;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMemberRow {
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'member' | 'viewer';
  created_at: string;
}

export interface AccountRow {
  id: string;
  name: string;
  gemini_api_key_encrypted: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ActivityLogRow {
  id: string;
  actor_id: string;
  action_type: string;
  target_type: string;
  target_id: string | null;
  old_value: unknown;
  new_value: unknown;
  created_at: string;
}

// ---------- Phase 2 ----------
export type BoardType = 'main' | 'private';
export type BoardSubscriberRole = 'owner' | 'member' | 'viewer';
export type NotificationLevel = 'everything' | 'replies_mentions' | 'nothing';
export type ColumnType =
  | 'task_name' | 'text' | 'status' | 'people' | 'date'
  | 'priority' | 'numbers' | 'checkbox' | 'dropdown' | 'link';

export interface BoardRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  icon_emoji: string;
  board_type: BoardType;
  owner_id: string;
  created_by: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface BoardSubscriberRow {
  board_id: string;
  user_id: string;
  role: BoardSubscriberRole;
  notification_level: NotificationLevel;
  subscribed_at: string;
}

export interface BoardFavoriteRow {
  user_id: string;
  board_id: string;
  favorited_at: string;
}

export interface BoardLastViewedRow {
  board_id: string;
  user_id: string;
  last_viewed_at: string;
}

export interface GroupRow {
  id: string;
  board_id: string;
  name: string;
  color: string;
  sort_order: number;
  is_collapsed_default: boolean;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

export interface ColumnRow {
  id: string;
  board_id: string;
  name: string;
  column_type: ColumnType;
  sort_order: number;
  width: number;
  is_required: boolean;
  is_pinned_left: boolean;
  is_pinned_right: boolean;
  default_value: unknown;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ColumnLabelRow {
  id: string;
  column_id: string;
  name: string;
  color: string;
  sort_order: number;
  is_default: boolean;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      users: { Row: UserRow; Insert: Partial<UserRow> & { id: string; email: string; username: string }; Update: Partial<UserRow> };
      workspaces: { Row: WorkspaceRow; Insert: Partial<WorkspaceRow> & { name: string }; Update: Partial<WorkspaceRow> };
      workspace_members: { Row: WorkspaceMemberRow; Insert: WorkspaceMemberRow; Update: Partial<WorkspaceMemberRow> };
      account: { Row: AccountRow; Insert: Partial<AccountRow> & { name: string }; Update: Partial<AccountRow> };
      activity_log: { Row: ActivityLogRow; Insert: Partial<ActivityLogRow> & { actor_id: string; action_type: string; target_type: string }; Update: Partial<ActivityLogRow> };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
}
