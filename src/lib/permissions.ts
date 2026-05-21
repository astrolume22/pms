/**
 * Frontend permission helpers. The server-side source of truth lives in
 * the RLS layer (migrations 0022+ — see docs/PERMISSIONS-REDESIGN-PLAN.md).
 *
 * Two roles only:
 *   - admin / super_admin → unrestricted UI
 *   - manager             → read-only on assigned boards EXCEPT the
 *                           Status cell + the comments composer.
 *
 * The "viewer" role still exists in the DB constraint for legacy rows
 * but the UI no longer creates new viewers and treats any viewer as a
 * non-admin (i.e. same gating as a manager — RLS will block their writes).
 */
import type { UserRow, ColumnRow } from './database.types';

export function isAdmin(profile: UserRow | null | undefined): boolean {
  return !!profile && (profile.role === 'admin' || profile.is_super_admin === true);
}

export function isManager(profile: UserRow | null | undefined): boolean {
  return !!profile && profile.role === 'manager' && !profile.is_super_admin;
}

/**
 * True when the current user is allowed to edit this specific cell.
 * Admins can edit every cell; managers can ONLY edit the Status column.
 */
export function canEditCell(profile: UserRow | null | undefined, column: ColumnRow): boolean {
  if (isAdmin(profile)) return true;
  // Manager (or any non-admin with board access via RLS): status only.
  return column.column_type === 'status';
}
