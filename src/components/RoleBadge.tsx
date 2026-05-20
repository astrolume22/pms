import type { UserRole } from '@/lib/database.types';
import { cn } from '@/lib/cn';

const STYLES: Record<UserRole, string> = {
  admin:   'bg-label-purple/15 text-label-purple',
  manager: 'bg-brand/15 text-brand',
  viewer:  'bg-label-grey/30 text-text-secondary',
};

const LABEL: Record<UserRole, string> = {
  admin: 'Admin',
  manager: 'Manager',
  viewer: 'Viewer',
};

export function RoleBadge({ role, className }: { role: UserRole; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center h-5 px-2 rounded-pill text-xs font-medium',
        STYLES[role],
        className,
      )}
    >
      {LABEL[role]}
    </span>
  );
}
