import { useState } from 'react';
import { Search, Check } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { useActiveUsers } from '@/hooks/users';
import { cn } from '@/lib/cn';

interface PersonPickerProps {
  selectedUserIds: string[];
  multi: boolean;
  onChange: (userIds: string[]) => void;
}

export function PersonPicker({ selectedUserIds, multi, onChange }: PersonPickerProps) {
  const { data: users } = useActiveUsers();
  const [q, setQ] = useState('');
  const list = (users ?? []).filter((u) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      u.username.toLowerCase().includes(needle)
      || (u.full_name?.toLowerCase().includes(needle) ?? false)
    );
  });

  const toggle = (id: string) => {
    if (multi) {
      onChange(selectedUserIds.includes(id) ? selectedUserIds.filter((x) => x !== id) : [...selectedUserIds, id]);
    } else {
      onChange(selectedUserIds.includes(id) ? [] : [id]);
    }
  };

  return (
    <div className="w-[280px]">
      <div className="p-2 border-b border-border-light">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-secondary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people"
            className="input h-8 text-xs pl-7"
            autoFocus
          />
        </div>
      </div>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {list.length === 0 && (
          <li className="px-3 py-2 text-xs text-text-disabled">No users found</li>
        )}
        {list.map((u) => {
          const isSelected = selectedUserIds.includes(u.id);
          return (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => toggle(u.id)}
                className={cn(
                  'w-full text-left px-3 py-1.5 inline-flex items-center gap-2',
                  'hover:bg-hover',
                  isSelected && 'bg-selected',
                )}
              >
                <Avatar name={u.full_name ?? u.username} url={u.avatar_url} size="sm" />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm truncate">{u.full_name ?? u.username}</span>
                  <span className="block text-xs text-text-secondary truncate">@{u.username}</span>
                </span>
                {isSelected && <Check className="h-4 w-4 text-brand shrink-0" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
