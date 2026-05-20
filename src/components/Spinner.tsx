import { cn } from '@/lib/cn';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin',
        className,
      )}
    />
  );
}

export function FullPageSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-app text-brand">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
