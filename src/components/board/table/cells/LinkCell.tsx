import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Popover } from '../Popover';
import { cn } from '@/lib/cn';
import type { CellProps } from './cellTypes';

export function LinkCell({ value, readonly, isEditing, onStartEdit, onEndEdit, onCommit }: CellProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const cur = (value as { url?: string; text?: string } | undefined) ?? { url: '', text: '' };
  const [url, setUrl] = useState(cur.url ?? '');
  const [text, setText] = useState(cur.text ?? '');

  useEffect(() => { setUrl(cur.url ?? ''); setText(cur.text ?? ''); }, [cur.url, cur.text]);

  const commit = () => {
    const u = url.trim();
    onEndEdit();
    if (!u) {
      onCommit(null);
      return;
    }
    if (u === cur.url && (text === cur.text || (!text && !cur.text))) return;
    const final = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    onCommit({ url: final, text: text.trim() || final });
  };

  return (
    <>
      <div
        ref={anchorRef}
        className={cn('w-full h-full px-3 flex items-center text-[14px] gap-1', !readonly && 'cursor-pointer')}
        onClick={() => !readonly && (isEditing ? onEndEdit() : onStartEdit())}
      >
        {cur.url ? (
          <>
            <a
              href={cur.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline truncate flex-1 min-w-0"
              onClick={(e) => e.stopPropagation()}
            >
              {cur.text || cur.url}
            </a>
            <ExternalLink className="h-3 w-3 text-text-secondary shrink-0" />
          </>
        ) : (
          <span className="text-text-disabled">—</span>
        )}
      </div>
      <Popover anchorRef={anchorRef} open={isEditing} onClose={commit} minWidth={280}>
        <div className="p-3 space-y-2 w-[280px]">
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wide text-text-secondary font-medium mb-1">URL</span>
            <input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="input h-8 text-[13px]"
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onEndEdit(); }}
            />
          </label>
          <label className="block">
            <span className="block text-[10px] uppercase tracking-wide text-text-secondary font-medium mb-1">Display text</span>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="(optional)"
              className="input h-8 text-[13px]"
              onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') onEndEdit(); }}
            />
          </label>
          <div className="flex justify-end gap-1">
            <button onClick={onEndEdit} className="btn-ghost h-7 px-2 text-[13px]">Cancel</button>
            <button onClick={commit} className="btn-primary h-7 px-3 text-[13px]">Save</button>
          </div>
        </div>
      </Popover>
    </>
  );
}
