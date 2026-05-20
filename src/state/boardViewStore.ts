/**
 * Per-board view state — search, sort, filter, hidden columns, group-by,
 * item-height, selection, expanded subitems, collapsed groups.
 *
 * Persisted bits (collapse + item height + hidden columns + sort) live
 * in localStorage keyed by (userId, boardId). Selection and search are
 * session-only.
 */
import { create } from 'zustand';

export type ItemHeight = 'compact' | 'comfortable' | 'spacious';

export interface SortSpec {
  columnId: string;
  direction: 'asc' | 'desc';
}

// Simple filter: "match any of these label_ids OR people user_ids per column".
// Cell types beyond labels/people aren't filterable in V1 (text/numbers/date
// filters arrive in V2).
export type ColumnFilter =
  | { kind: 'labels'; columnId: string; valueIds: string[] }
  | { kind: 'people'; columnId: string; userIds: string[] };

interface Persisted {
  collapsedGroupIds: string[];
  hiddenColumnIds: string[];
  itemHeight: ItemHeight;
  sort: SortSpec | null;
  groupByColumnId: string | null;
}

const DEFAULT_PERSISTED: Persisted = {
  collapsedGroupIds: [],
  hiddenColumnIds: [],
  itemHeight: 'comfortable',
  sort: null,
  groupByColumnId: null,
};

const storageKey = (boardId: string, userId: string) => `pms.board-view.${userId}.${boardId}`;

function readPersisted(boardId: string, userId: string): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(boardId, userId));
    if (!raw) return { ...DEFAULT_PERSISTED };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return { ...DEFAULT_PERSISTED, ...parsed };
  } catch {
    return { ...DEFAULT_PERSISTED };
  }
}

function writePersisted(boardId: string, userId: string, p: Persisted) {
  try {
    localStorage.setItem(storageKey(boardId, userId), JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

interface BoardViewState {
  hydratedForKey: string | null;
  persisted: Persisted;
  search: string;
  filters: ColumnFilter[];
  selectedItemIds: Set<string>;
  expandedItemIds: Set<string>;

  hydrate: (boardId: string, userId: string) => void;
  reset: () => void;
  setSearch: (s: string) => void;
  setSort: (s: SortSpec | null) => void;
  setItemHeight: (h: ItemHeight) => void;
  setGroupByColumnId: (id: string | null) => void;
  setColumnHidden: (id: string, hidden: boolean) => void;
  toggleColumnHidden: (id: string) => void;
  setGroupCollapsed: (groupId: string, collapsed: boolean) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  setFilters: (f: ColumnFilter[]) => void;
  clearFilters: () => void;

  toggleSelected: (itemId: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
  setExpanded: (id: string, expanded: boolean) => void;
  toggleExpanded: (id: string) => void;
}

const useStore = create<BoardViewState>((set, get) => {
  const persist = (next: Persisted) => {
    const key = get().hydratedForKey;
    if (!key) return;
    const [userId, boardId] = key.split('::');
    writePersisted(boardId, userId, next);
  };
  return {
    hydratedForKey: null,
    persisted: { ...DEFAULT_PERSISTED },
    search: '',
    filters: [],
    selectedItemIds: new Set(),
    expandedItemIds: new Set(),

    hydrate: (boardId, userId) => {
      const key = `${userId}::${boardId}`;
      if (get().hydratedForKey === key) return;
      set({
        hydratedForKey: key,
        persisted: readPersisted(boardId, userId),
        search: '',
        filters: [],
        selectedItemIds: new Set(),
        expandedItemIds: new Set(),
      });
    },
    reset: () => {
      set({
        hydratedForKey: null,
        persisted: { ...DEFAULT_PERSISTED },
        search: '',
        filters: [],
        selectedItemIds: new Set(),
        expandedItemIds: new Set(),
      });
    },

    setSearch: (s) => set({ search: s }),
    setSort: (s) => { const next = { ...get().persisted, sort: s }; set({ persisted: next }); persist(next); },
    setItemHeight: (h) => { const next = { ...get().persisted, itemHeight: h }; set({ persisted: next }); persist(next); },
    setGroupByColumnId: (id) => { const next = { ...get().persisted, groupByColumnId: id }; set({ persisted: next }); persist(next); },

    setColumnHidden: (id, hidden) => {
      const cur = get().persisted.hiddenColumnIds;
      const list = hidden ? Array.from(new Set([...cur, id])) : cur.filter((x) => x !== id);
      const next = { ...get().persisted, hiddenColumnIds: list };
      set({ persisted: next }); persist(next);
    },
    toggleColumnHidden: (id) => {
      const isHidden = get().persisted.hiddenColumnIds.includes(id);
      get().setColumnHidden(id, !isHidden);
    },

    setGroupCollapsed: (groupId, collapsed) => {
      const cur = get().persisted.collapsedGroupIds;
      const list = collapsed ? Array.from(new Set([...cur, groupId])) : cur.filter((x) => x !== groupId);
      const next = { ...get().persisted, collapsedGroupIds: list };
      set({ persisted: next }); persist(next);
    },
    toggleGroupCollapsed: (groupId) => {
      const isCollapsed = get().persisted.collapsedGroupIds.includes(groupId);
      get().setGroupCollapsed(groupId, !isCollapsed);
    },

    setFilters: (filters) => set({ filters }),
    clearFilters: () => set({ filters: [] }),

    toggleSelected: (itemId) => {
      const next = new Set(get().selectedItemIds);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      set({ selectedItemIds: next });
    },
    setSelected: (ids) => set({ selectedItemIds: new Set(ids) }),
    clearSelected: () => set({ selectedItemIds: new Set() }),

    setExpanded: (id, expanded) => {
      const next = new Set(get().expandedItemIds);
      if (expanded) next.add(id);
      else next.delete(id);
      set({ expandedItemIds: next });
    },
    toggleExpanded: (id) => {
      const isExp = get().expandedItemIds.has(id);
      get().setExpanded(id, !isExp);
    },
  };
});

export const useBoardViewStore = useStore;

export const ITEM_HEIGHT_PX: Record<ItemHeight, number> = {
  compact: 32,
  comfortable: 40,
  spacious: 56,
};
