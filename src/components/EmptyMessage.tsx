import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/cn';

interface EmptyMessageProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: { label: string; to?: string; onClick?: () => void };
  className?: string;
}

export function EmptyMessage({ title, description, icon, action, className }: EmptyMessageProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center px-6 py-12', className)}>
      {icon && (
        <div className="h-14 w-14 rounded-pill bg-app flex items-center justify-center mb-4 text-text-secondary">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      {description && <p className="text-sm text-text-secondary max-w-md">{description}</p>}
      {action && (
        <div className="mt-4">
          {action.to ? (
            <Link to={action.to} className="btn-primary">
              {action.label}
            </Link>
          ) : (
            <button type="button" onClick={action.onClick} className="btn-primary">
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
