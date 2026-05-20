import { cn } from '@/lib/cn';

const SIZE = {
  xs: 'h-5 w-5 text-[10px]',
  sm: 'h-6 w-6 text-[11px]',
  md: 'h-8 w-8 text-[12px]',
  lg: 'h-10 w-10 text-sm',
  xl: 'h-16 w-16 text-lg',
} as const;

const PALETTE = [
  '#00C875', '#E2445C', '#FDAB3D', '#A25DDC', '#0086C0',
  '#579BFC', '#037F4C', '#FF158A', '#9CD326', '#225091',
];

function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

interface AvatarProps {
  name: string;
  url?: string | null;
  size?: keyof typeof SIZE;
  className?: string;
}

export function Avatar({ name, url, size = 'md', className }: AvatarProps) {
  const color = PALETTE[hashName(name) % PALETTE.length];
  return (
    <div
      className={cn(
        'inline-flex items-center justify-center rounded-pill text-white font-medium select-none overflow-hidden',
        SIZE[size],
        className,
      )}
      style={{ background: url ? undefined : color }}
      aria-label={name}
    >
      {url ? (
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
