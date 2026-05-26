/**
 * Phase 6 — admin user-management hooks.
 *
 * Every write goes through a SECURITY DEFINER Postgres function in
 * migration 0018, which runs the role + super-admin guards server-side.
 * The frontend never gets the service-role key or any raw passwords
 * back from these calls.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { UserRole, UserStatus } from '@/lib/database.types';

export const adminKeys = {
  users: ['admin', 'users'] as const,
  secretsStatus: ['admin', 'secrets-status'] as const,
};

export interface AdminUserRow {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  status: UserStatus;
  is_super_admin: boolean;
  title: string | null;
  timezone: string;
  created_at: string;
  last_active: string | null;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: async (): Promise<AdminUserRow[]> => {
      const { data, error } = await supabase.rpc('admin_list_users');
      if (error) throw error;
      return (data as AdminUserRow[]) ?? [];
    },
    staleTime: 10_000,
  });
}

export function useAdminSecretsStatus() {
  return useQuery({
    queryKey: adminKeys.secretsStatus,
    queryFn: async (): Promise<{ configured: boolean }> => {
      const { data, error } = await supabase.rpc('get_admin_secrets_status');
      if (error) throw error;
      return (data as { configured: boolean }) ?? { configured: false };
    },
    staleTime: 60_000,
  });
}

export function useSetAdminSecrets() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { serviceRoleKey: string; supabaseUrl: string }) => {
      const { error } = await supabase.rpc('set_admin_secrets', {
        p_key: args.serviceRoleKey,
        p_url: args.supabaseUrl,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.secretsStatus }),
  });
}

export function useAdminCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      username: string;
      fullName: string;
      role: Exclude<UserRole, 'admin'>;
      password: string;
    }) => {
      const { error } = await supabase.rpc('admin_create_user', {
        p_username: args.username,
        p_full_name: args.fullName,
        p_role: args.role,
        p_password: args.password,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

export function useAdminResetPassword() {
  return useMutation({
    mutationFn: async (args: { userId: string; newPassword: string }) => {
      const { error } = await supabase.rpc('admin_reset_password', {
        p_user_id: args.userId,
        p_new_password: args.newPassword,
      });
      if (error) throw error;
    },
  });
}

export function useAdminSetRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; role: UserRole }) => {
      const { error } = await supabase.rpc('admin_set_role', {
        p_user_id: args.userId,
        p_role: args.role,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

// Migration 0042 — admin renames a user's username. Validates the
// regex + uniqueness server-side. Does NOT touch the user's email or
// auth identity — they can still log in by email AND by the new
// username (resolve_login_email matches either branch).
export function useAdminSetUsername() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; newUsername: string }) => {
      const { error } = await supabase.rpc('admin_set_username', {
        p_user_id: args.userId,
        p_new_username: args.newUsername,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

// Migration 0043 — permanent delete. Admin-only via is_admin(). The RPC
// also refuses self-delete, the last active admin, and any super admin.
// The user's CONTENT (boards, items, updates, views, files, invites
// they minted, AI runs, audit-log rows) survives with the author column
// set to NULL — per the DATA OWNERSHIP RULE (SET NULL never CASCADE on
// authorship FKs).
export function useAdminDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string }) => {
      const { error } = await supabase.rpc('admin_delete_user', {
        p_user_id: args.userId,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}

export function useAdminSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; status: UserStatus }) => {
      const { error } = await supabase.rpc('admin_set_status', {
        p_user_id: args.userId,
        p_status: args.status,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.users }),
  });
}
