import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronDown, ChevronRight, GripVertical, MoreHorizontal, Trash2, Pencil, Copy, Palette, Check,
} from 'lucide-react';
import { useDuplicateGroup } from '@/hooks/duplicate';
import type { GroupRow, ColumnRow, ColumnLabelRow, ItemRow } from '@/lib/database.types';
import { ItemRow as ItemRowComp } from './ItemRow';
import { AddItemRow } from './AddItemRow';
import { SummaryStrip } from './SummaryStrip';
import { ColumnHeaderRow } from './ColumnHeaderRow';
import { useUpdateGroup, useDeleteGroup } from '@/hooks/groups';
import { useBoardViewStore } from '@/state/boardViewStore';
import { cn } from '@/lib/cn';
import { toast } from 'sonner';

interface GroupBlockProps {
  group: GroupRow;
  items: ItemRow[];
  columns: ColumnRow[];
  visibleColumns: ColumnRow[];
  labelsByColumnId: Map<string, ColumnLabelRow[]>;
  valuesByItemColumn: Map<string, unknown>;
  boardId: string;
  canEdit: boolean;
  subitemsByParent: Map<string, ItemRow[]>;
  onOpenLabelsEditor: (col: ColumnRow) => void;
  // Pixel width that every row in the table needs to occupy so the rows line up
  // with the column-header row inside the single horizontal scroll container.
  rowMinWidth: number;
  // Sortable-context column-id list, passed through to the per-group
  // ColumnHeaderRow. Owned by BoardContent (the source of truth) so all
  // groups stay locked in step.
  columnIds: string[];
}

// Group-spine + title colors — 8 curated hues anchored on the OKLCH
// chip palette so the spine reads as one visual family with the chips
// it sits next to. Stored verbatim in group.color (CSS color() values
// are valid wherever a hex is — the inline style consumes them as-is).
const COLORS = [
  'oklch(0.70 0.16 25)',   // coral
  'oklch(0.70 0.16 70)',   // amber
  'oklch(0.70 0.14 160)',  // mint
  'oklch(0.65 0.10 200)',  // teal
  'oklch(0.70 0.12 230)',  // sky
  'oklch(0.65 0.15 295)',  // purple
  'oklch(0.65 0.18 350)',  // pink
  'oklch(0.65 0.05 250)',  // slate
];

export function GroupBlock({
  group, items, columns, visibleColumns, labelsByColumnId, valuesByItemColumn,
  boardId, canEdit, subitemsByParent, onOpenLabelsEditor, rowMinWidth, columnIds,
}: GroupBlockProps) {
  const sortable = useSortable({ id: `group:${group.id}`, disabled: !canEdit });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  const collapsed = useBoardViewStore((s) => s.persisted.collapsedGroupIds.includes(group.id));
  const toggleCollapsed = useBoardViewStore((s) => s.toggleGroupCollapsed);
  const expandedItemIds = useBoardViewStore((s) => s.expandedItemIds);
  const toggleExpanded = useBoardViewStore((s) => s.toggleExpanded);

  const update = useUpdateGroup();
  const remove = useDeleteGroup();
  const duplicate = useDuplicateGroup();

  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(group.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // The trigger button so we can compute the portaled dropdown's fixed
  // position from its bounding rect. The wrapper menuRef wraps both the
  // trigger and the (now-portaled) dropdown; trigger needs its own ref
  // so getBoundingClientRect() is on the button, not the wrapper.
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Portaled dropdown / color-picker need a separate ref so the outside-
  // click handler doesn't treat clicks INSIDE the portaled menu as
  // "outside" (the portal lives in document.body, not inside menuRef).
  const portalRef = useRef<HTMLDivElement>(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  // 0046+ clipping fix: the ⋯ dropdown was rendered inline at
  // absolute/z-30 inside the group title row's sticky z-[4] stacking
  // context. When the group is COLLAPSED, the dropdown extends into the
  // NEXT group's sibling stacking context (also z-4, later in DOM
  // order) which paints over it — so only the top sliver shows. Fix:
  // render the dropdown in a portal at position:fixed anchored to the
  // trigger's rect, escaping every parent stacking context.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const updateMenuPos = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenuPos({
      // 4px gap below the trigger.
      top:   r.bottom + 4,
      // align the dropdown's right edge with the trigger's right edge.
      right: window.innerWidth - r.right,
    });
  };

  useEffect(() => setDraftName(group.name), [group.name]);

  // Recompute on open + on scroll/resize while open so a parent scroll
  // doesn't leave the menu floating where the button no longer is.
  useLayoutEffect(() => {
    if (!menuOpen && !colorPickerOpen) { setMenuPos(null); return; }
    updateMenuPos();
    const reflow = () => updateMenuPos();
    window.addEventListener('resize', reflow);
    // Capture-phase so we catch the horizontal scroll on BoardContent
    // and any other scrollable ancestor.
    window.addEventListener('scroll', reflow, true);
    return () => {
      window.removeEventListener('resize', reflow);
      window.removeEventListener('scroll', reflow, true);
    };
  }, [menuOpen, colorPickerOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      // Click on the trigger button itself toggles via its own onClick.
      if (menuRef.current?.contains(target)) return;
      // Click inside the portaled menu shouldn't close it.
      if (portalRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const commitName = async () => {
    setRenaming(false);
    const trimmed = draftName.trim();
    if (!trimmed || trimmed === group.name) { setDraftName(group.name); return; }
    try {
      await update.mutateAsync({ id: group.id, boardId, patch: { name: trimmed } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Rename failed');
      setDraftName(group.name);
    }
  };

  const itemIds = items.map((i) => i.id);

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={cn(
        // The group is a stack: header (no spine) → data block (spine).
        // The header lives outside the colored bar per spec ("spine starts
        // at the column header row, ends at the summary strip — does NOT
        // extend through the group title").
        'bg-canvas',
        sortable.isDragging && 'opacity-50',
      )}
    >
      {/* Group header — sticky-left so the title/menu stay visible when
          the user scrolls horizontally. NO colored spine through the
          header row — only the caret + title carry the group color.
          Order per spec: drag (hover) → caret (in color) → title (in
          color, 16/600) → "N tasks" gray pill → spacer → overflow ⋯
          (hover-only). */}
      <div
        className="group/groupheader sticky left-0 z-[4] flex items-center gap-2 h-11 px-3 bg-canvas"
        style={{ maxWidth: 'calc(100vw - 320px)' }}
      >
        {canEdit && (
          <button
            type="button"
            {...sortable.attributes}
            {...sortable.listeners}
            className="opacity-0 group-hover/groupheader:opacity-50 hover:!opacity-100 h-5 w-3 flex items-center justify-center text-text-secondary cursor-grab active:cursor-grabbing transition-opacity duration-100"
            aria-label="Drag group"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toggleCollapsed(group.id)}
          className="h-6 w-6 inline-flex items-center justify-center rounded-sm hover:bg-[var(--overlay-8)]"
          aria-label={collapsed ? 'Expand group' : 'Collapse group'}
          // Caret picks up the group's identity color so it ties to the
          // spine below.
          style={{ color: group.color }}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {renaming ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              // NOTE: don't commit on blur — the user might be clicking the Save
              // button. Pressing Save / Enter / Escape are the explicit exits.
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitName();
                } else if (e.key === 'Escape') {
                  setDraftName(group.name);
                  setRenaming(false);
                }
              }}
              className="group-title-text bg-surface border border-brand rounded-sm px-1.5 py-0.5 outline-none min-w-[180px]"
              style={{ color: group.color }}
            />
            <button
              type="button"
              onClick={() => void commitName()}
              disabled={update.isPending}
              aria-label="Save group name"
              title="Save (Enter)"
              className="h-6 px-2 inline-flex items-center gap-1 rounded-sm bg-brand text-white text-[13px] font-medium hover:bg-brand-hover disabled:opacity-40"
            >
              <Check className="h-3 w-3" />
              Save
            </button>
            <button
              type="button"
              onClick={() => { setDraftName(group.name); setRenaming(false); }}
              className="h-6 px-2 rounded-sm text-text-secondary text-[13px] hover:bg-hover"
              title="Cancel (Esc)"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            // Single click — matches Monday. Title doubles as the rename
            // affordance; the Rename menu item is also wired up below.
            onClick={() => canEdit && setRenaming(true)}
            className={cn(
              'group-title-text rounded-sm px-1 -mx-1',
              canEdit && 'hover:bg-hover cursor-text',
            )}
            style={{ color: group.color }}
            title={canEdit ? 'Click to rename' : ''}
          >
            {group.name}
          </button>
        )}
        <span
          className="inline-flex items-center h-5 px-2 rounded-pill text-[12px] font-medium text-text-secondary"
          style={{ background: 'var(--overlay-6)' }}
          title={`${items.length} task${items.length === 1 ? '' : 's'}`}
        >
          {items.length} task{items.length === 1 ? '' : 's'}
        </span>

        {canEdit && (
          <div ref={menuRef} className="ml-auto">
            <button
              ref={triggerRef}
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label="Group menu"
              className="opacity-0 group-hover/groupheader:opacity-100 h-6 w-6 inline-flex items-center justify-center rounded-sm text-text-secondary hover:bg-[var(--overlay-8)] transition-opacity duration-100"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {/* Dropdown — PORTALED to document.body with position:fixed
                so it escapes the group title row's sticky z-[4] stacking
                context (without the portal, when the group is collapsed
                the menu extends into the next group's sibling stacking
                context and gets clipped to a sliver). z-50 keeps it
                above every other floating UI. */}
            {menuOpen && menuPos && createPortal(
              <div
                ref={portalRef}
                className="fixed z-50 w-44 bg-surface border border-border-light rounded-md shadow-lg overflow-hidden"
                style={{ top: menuPos.top, right: menuPos.right }}
              >
                <button
                  onClick={() => { setMenuOpen(false); setRenaming(true); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover"
                >
                  <Pencil className="h-3.5 w-3.5 text-text-secondary" /> Rename
                </button>
                <button
                  onClick={() => { setMenuOpen(false); setColorPickerOpen(true); }}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover"
                >
                  <Palette className="h-3.5 w-3.5 text-text-secondary" /> Change color
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    try {
                      await duplicate.mutateAsync({ groupId: group.id, boardId });
                      toast.success('Group duplicated');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Duplicate failed');
                    }
                  }}
                  disabled={duplicate.isPending}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-hover disabled:opacity-50"
                >
                  <Copy className="h-3.5 w-3.5 text-text-secondary" /> Duplicate
                </button>
                <button
                  onClick={async () => {
                    setMenuOpen(false);
                    if (items.length > 0 &&
                        !window.confirm(`Delete group "${group.name}" and its ${items.length} task${items.length===1?'':'s'}?`)) return;
                    try {
                      await remove.mutateAsync({ id: group.id, boardId });
                      toast.success('Group deleted');
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Delete failed');
                    }
                  }}
                  className="w-full text-left px-3 py-1.5 text-[13px] flex items-center gap-2 hover:bg-error/10 text-error"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete group
                </button>
              </div>,
              document.body,
            )}
            {/* Color picker — same portal treatment for the same reason.
                Opens via Change color and closes on outside click. */}
            {colorPickerOpen && menuPos && createPortal(
              <div
                ref={portalRef}
                className="fixed z-50 bg-card rounded-card p-3 grid grid-cols-4 gap-2 w-[180px]"
                style={{
                  top: menuPos.top,
                  right: menuPos.right,
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px var(--overlay-6)',
                }}
                onMouseLeave={() => setColorPickerOpen(false)}
              >
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={async () => {
                      setColorPickerOpen(false);
                      try {
                        await update.mutateAsync({ id: group.id, boardId, patch: { color: c } });
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : 'Color update failed');
                      }
                    }}
                    className={cn(
                      'h-7 w-full rounded-button',
                      group.color === c && 'ring-2 ring-white ring-offset-2 ring-offset-card',
                    )}
                    style={{ background: c }}
                    aria-label={c}
                  />
                ))}
              </div>,
              document.body,
            )}
          </div>
        )}
      </div>

      {!collapsed && (
        <div
          // Data block: column-headers → rows → "+ Add task" → summary
          // strip all live under a single 4px colored left spine in the
          // group's identity color. Radius 0 8 8 0 with overflow hidden
          // so the spine reads as a continuous left edge.
          className="relative overflow-hidden"
          style={{
            minWidth: rowMinWidth,
            borderLeft: `4px solid ${group.color}`,
            borderTopRightRadius: 8,
            borderBottomRightRadius: 8,
          }}
        >
          {/* Per-group column-header row — Monday-style. Sits at the top
              of the spine container so it aligns with the rows below it
              and inherits the same 4px colored left edge. Width / sticky
              behavior / live-resize all match ItemRow via the shared
              boardViewStore.liveColumnWidths source. */}
          <ColumnHeaderRow
            boardId={boardId}
            canEdit={canEdit}
            visibleColumns={visibleColumns}
            columnIds={columnIds}
            rowMinWidth={rowMinWidth}
            onOpenLabelsEditor={onOpenLabelsEditor}
            groupId={group.id}
          />
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            {items.map((it) => {
              const kids = subitemsByParent.get(it.id) ?? [];
              const isExp = expandedItemIds.has(it.id);
              return (
                <div key={it.id} className="mb-px bg-canvas">
                  <ItemRowComp
                    item={it}
                    columns={columns}
                    visibleColumns={visibleColumns}
                    labelsByColumnId={labelsByColumnId}
                    valuesByItemColumn={valuesByItemColumn}
                    boardId={boardId}
                    canEdit={canEdit}
                    hasSubitems={kids.length > 0}
                    onToggleSubitems={() => toggleExpanded(it.id)}
                    onOpenLabelsEditor={onOpenLabelsEditor}
                  />
                  {isExp && (
                    <div className="pl-10 bg-canvas">
                      {kids.map((sub) => (
                        <ItemRowComp
                          key={sub.id}
                          item={sub}
                          columns={columns}
                          visibleColumns={visibleColumns}
                          labelsByColumnId={labelsByColumnId}
                          valuesByItemColumn={valuesByItemColumn}
                          boardId={boardId}
                          canEdit={canEdit}
                          isSubitem
                          onOpenLabelsEditor={onOpenLabelsEditor}
                        />
                      ))}
                      {/* Subitem-add row — admin only */}
                      {canEdit && (
                        <AddItemRow
                          boardId={boardId}
                          groupId={group.id}
                          parentItemId={it.id}
                          totalWidth={rowMinWidth}
                          placeholder="+ Add subitem"
                          disabled={false}
                        />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </SortableContext>
          {/* Group's "+ Add task" footer row — admin only */}
          {canEdit && (
            <AddItemRow
              boardId={boardId}
              groupId={group.id}
              totalWidth={rowMinWidth}
              disabled={false}
            />
          )}
          {/* Premium polish: 6px per-column stacked color summary strip,
              replacing the old numeric ColumnFooter. Aligned to columns
              by the same widths ItemRow uses. */}
          <SummaryStrip
            visibleColumns={visibleColumns}
            items={items}
            valuesByItemColumn={valuesByItemColumn}
            labelsByColumnId={labelsByColumnId}
          />
        </div>
      )}
    </div>
  );
}
