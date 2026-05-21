import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE = {
  sm: 'max-w-[400px]',
  md: 'max-w-[560px]',
  lg: 'max-w-[760px]',
};

export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative w-full bg-surface text-text-primary border border-border-light rounded-md shadow-xl',
          'animate-[fadeIn_120ms_ease-out]',
          // Cap the modal to the viewport so it never spills below the
          // fold. Header + footer stay fixed; body region scrolls.
          'flex flex-col max-h-[calc(100vh-48px)]',
          SIZE[size],
        )}
      >
        <header className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border-light">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-8 w-8 inline-flex items-center justify-center rounded-base text-text-secondary hover:bg-hover"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="shrink-0 px-5 py-3 border-t border-border-light flex items-center justify-end gap-2 bg-surface">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
