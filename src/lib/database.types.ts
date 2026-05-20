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
