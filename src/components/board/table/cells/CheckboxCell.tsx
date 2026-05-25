import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';
import { readCheckboxValue } from './cellValue';

export function CheckboxCell({ value, readonly, onCommit }: CellProps) {
  // Defensive normalize — see cellValue.ts.
  const checked = readCheckboxValue(value);
  return (
    <div className="w-full h-full flex items-center justify-center">
      <button
        type="button"
        disabled={readonly}
        onClick={() => onCommit({ checked: !checked })}
        className={cn(
          'h-5 w-5 rounded-sm border inline-flex items-center justify-center transition-colors duration-100',
          checked ? 'bg-success border-success text-white' : 'border-border-medium hover:border-brand',
        )}
        aria-checked={checked}
        role="checkbox"
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}
