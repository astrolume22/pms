import { useRef } from 'react';
import { Avatar } from '@/components/Avatar';
import { Popover } from '../Popover';
import { PersonPicker } from '../PersonPicker';
import { useActiveUsers } from '@/hooks/users';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

export function PeopleCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const userIds = (value as { user_ids?: string[] } | undefined)?.user_ids ?? [];
  const { data: users } = useActiveUsers();
  const selected = userIds
    .map((id) => users?.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  return (
    <>
      <div
        ref={anchorRef}
        className={cn(
          'w-full h-full flex items-center px-2 gap-1 overflow-hidden',
          !readonly && 'cursor-pointer',
        )}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {selected.length === 0 ? (
          <span className="text-xs text-text-disabled">—</span>
        ) : (
          <div className="flex items-center -space-x-1">
            {selected.slice(0, 4).map((u) => (
              <Avatar
                key={u.id}
                name={u.full_name ?? u.username}
                url={u.avatar_url}
                size="sm"
                className="ring-2 ring-surface"
              />
            ))}
            {selected.length > 4 && (
              <span className="ml-1 inline-flex items-center justify-center h-6 px-1.5 text-[10px] font-medium text-text-secondary bg-app rounded-pill">
                +{selected.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={onEndEdit} minWidth={280}>
        <PersonPicker
          selectedUserIds={userIds}
          multi
          onChange={(ids) => {
            onCommit(ids.length > 0 ? { user_ids: ids } : null);
          }}
        />
      </Popover>
    </>
  );
}
