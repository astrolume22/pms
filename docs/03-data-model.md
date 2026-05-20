# 🗄️ PMS — Data Model (Database Schema)

> **Document 3 of 9** — The most important planning doc. Every table, field, relationship.
> This is what Lovable / Supabase will create. Get this right → everything else flows.

---

## 1. Schema Overview — Top-Down Hierarchy

```
account (single row — our company)
  └── users (everyone)
  └── workspaces
       └── folders (optional)
            └── boards
                 └── groups
                      └── items (tasks)
                           └── subitems
                                └── (column values, updates, files, activity, etc.)
                 └── views
                 └── columns
                 └── automations
            └── docs
            └── dashboards
                 └── widgets
            └── forms
```

---

## 2. CORE TABLES

### 2.1 `account`
The single tenant. One row only.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | "Our Company Name" |
| logo_url | text | |
| primary_color | text | branding |
| timezone | text | default tz |
| gemini_api_key_encrypted | text | encrypted Gemini API key |
| created_at | timestamptz | |
| settings_jsonb | jsonb | flexible — e.g., default item height, default theme |

### 2.2 `users`
Extends Supabase `auth.users`.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | same as auth.users.id |
| email | text | unique |
| full_name | text | nullable until user signs up |
| avatar_url | text | |
| role | enum | `admin`, `member`, `viewer`, `guest` |
| status | enum | `active`, `invited`, `deactivated`, `cancelled` |
| title | text | job title |
| department | text | |
| phone | text | |
| timezone | text | |
| location | text | |
| working_hours | jsonb | { mon: [9,17], tue: [...], etc. } |
| birthday | date | |
| skills | text[] | |
| notification_prefs | jsonb | per-channel settings |
| theme | enum | `light`, `dark`, `system` |
| language | text | |
| is_super_admin | boolean | only one user, founder |
| created_at | timestamptz | |
| last_active_at | timestamptz | |
| deactivated_at | timestamptz | |

### 2.3 `user_invites` (NEW — invite token management)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | the pending user row |
| token | text unique | secure random string (UUID or longer) |
| email | text | denormalized for lookup |
| invited_by | uuid FK → users | admin who sent invite |
| message | text | optional custom message |
| expires_at | timestamptz | default: now() + 7 days |
| used_at | timestamptz | nullable — set when accepted |
| revoked_at | timestamptz | nullable — set if admin cancels |
| created_at | timestamptz | |
| resend_count | int | how many times resent |

**Indexes:**
- `token` unique
- `email` (for lookup on admin view)
- `(used_at, expires_at)` for cleanup queries

**RLS:**
- SELECT: token-based read allowed (for signup page verification) + admin can see all
- INSERT: admin only
- UPDATE: system only (via edge function on acceptance)

---

## 3. WORKSPACES

### 3.1 `workspaces`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | "Main workspace", "Marketing", etc. |
| description | text | |
| icon_emoji | text | optional emoji icon |
| icon_color | text | bg color for icon (orange in screenshots) |
| icon_url | text | optional uploaded image |
| is_main | boolean | the default workspace, cannot be deleted |
| visibility | enum | `open` (everyone), `closed` (members only), `private` |
| created_by | uuid FK → users | |
| created_at | timestamptz | |

### 3.2 `workspace_members`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| user_id | uuid FK | |
| role | enum | `owner`, `member`, `collaborator` |
| added_at | timestamptz | |
| added_by | uuid FK → users | |

### 3.3 `folders`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| parent_folder_id | uuid FK → folders | nullable (for nested folders) |
| name | text | |
| icon_emoji | text | |
| sort_order | int | |
| created_by | uuid FK | |
| created_at | timestamptz | |

---

## 4. BOARDS

### 4.1 `boards`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| folder_id | uuid FK | nullable |
| name | text | "Team Projects" |
| description | text | rich text |
| icon_emoji | text | |
| board_type | enum | `main`, `shareable`, `private` |
| owner_id | uuid FK → users | |
| created_by | uuid FK → users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| archived_at | timestamptz | nullable |
| deleted_at | timestamptz | nullable (soft delete) |
| settings_jsonb | jsonb | item_height, conditional_coloring rules, pinned_columns, etc. |
| is_multi_level | boolean | "multi-level board" type from add-new menu |

### 4.2 `board_subscribers`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| user_id | uuid FK | |
| role | enum | `owner`, `member`, `viewer`, `guest` |
| notification_level | enum | `everything`, `replies_mentions`, `nothing` |
| subscribed_at | timestamptz | |

### 4.3 `board_favorites`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | |
| board_id | uuid FK | |
| favorited_at | timestamptz | |

> `(user_id, board_id)` unique

---

## 5. GROUPS

### 5.1 `groups`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| name | text | "Team Red Projects" |
| color | text | hex (#FF0066 pink, #00C875 green, etc.) |
| sort_order | int | |
| is_collapsed_default | boolean | |
| created_at | timestamptz | |

---

## 6. COLUMNS

### 6.1 `columns`
This is the schema for column definitions per board.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| name | text | "Task", "Status", "Co-Work Time" |
| type | enum | `text`, `long_text`, `numbers`, `status`, `dropdown`, `people`, `date`, `timeline`, `files`, `checkbox`, `priority`, `doc`, `formula`, `connect_boards`, `link`, `email`, `phone`, `rating`, `progress`, `time_tracking`, `tags`, `country`, `location`, `auto_number`, `creation_log`, `last_updated`, `vote`, `button`, `mirror`, `dependency`, `world_clock`, `color_picker` |
| sort_order | int | |
| width | int | resizable, in pixels |
| is_required | boolean | new items must fill this |
| is_pinned_left | boolean | |
| is_pinned_right | boolean | |
| default_value | jsonb | |
| settings_jsonb | jsonb | type-specific config (see below) |
| created_at | timestamptz | |

### 6.2 Type-specific `settings_jsonb` shapes

#### `status` & `dropdown` & `priority`
Labels are stored in a separate table (see 6.3) because they have IDs, colors, sort_order, and references from cell values. `settings_jsonb` here might just be `{ allow_multiple: false }`.

#### `numbers`
```json
{ "unit": "$", "unit_position": "prefix", "decimals": 2, "summary": "sum" }
```

#### `date`
```json
{ "include_time": true, "default_today": false }
```

#### `timeline`
```json
{ "include_time": false }
```

#### `people`
```json
{ "allow_multiple": true, "include_teams": true }
```

#### `formula`
```json
{ "expression": "{Hours} * {Rate}", "result_type": "number" }
```

#### `rating`
```json
{ "max": 5, "icon": "star" }
```

### 6.3 `column_labels` (for status, dropdown, priority columns)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| column_id | uuid FK | |
| name | text | "Done", "Working on it", "High" |
| color | text | hex |
| pattern | text | optional — diagonal stripes etc. (saw in Edit Labels modal) |
| sort_order | int | |
| is_default | boolean | "Default Label" — applied to new items if no value |
| created_at | timestamptz | |

---

## 7. ITEMS (Tasks)

### 7.1 `items`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| group_id | uuid FK | |
| parent_item_id | uuid FK → items | nullable — set if this is a subitem |
| name | text | "Read This Instruction -2" |
| task_code | text | auto-generated: "Task 1", "Task 11-A" |
| sort_order | int | within group |
| created_by | uuid FK | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| archived_at | timestamptz | |
| deleted_at | timestamptz | |

### 7.2 `item_column_values`
The actual cell data lives here.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid FK | |
| column_id | uuid FK | |
| value_jsonb | jsonb | shape depends on column type (see below) |
| updated_by | uuid FK | |
| updated_at | timestamptz | |

> **Index**: unique on `(item_id, column_id)`

### 7.3 `value_jsonb` shape per column type

| Column type | Example value |
|---|---|
| `text` | `{ "text": "Hello" }` |
| `long_text` | `{ "text": "Long markdown..." }` |
| `numbers` | `{ "value": 42.5 }` |
| `status` | `{ "label_id": "uuid" }` |
| `dropdown` | `{ "label_ids": ["uuid1", "uuid2"] }` |
| `priority` | `{ "label_id": "uuid" }` |
| `people` | `{ "user_ids": ["uuid1"], "team_ids": ["uuid"] }` |
| `date` | `{ "date": "2026-05-19", "time": "14:30" }` |
| `timeline` | `{ "start": "2026-05-01", "end": "2026-05-31" }` |
| `files` | `{ "file_ids": ["uuid1", "uuid2"] }` |
| `checkbox` | `{ "checked": true }` |
| `link` | `{ "url": "https://...", "text": "Display name" }` |
| `email` | `{ "email": "x@y.com" }` |
| `phone` | `{ "phone": "+1...", "country": "US" }` |
| `rating` | `{ "rating": 4 }` |
| `formula` | (computed at read-time, not stored) |
| `auto_number` | (computed) |
| `creation_log` | (computed from item created_by/created_at) |
| `last_updated` | (computed from item updated_by/updated_at) |
| `time_tracking` | `{ "total_seconds": 3600, "sessions": [...] }` |

### 7.4 `item_subscribers` (watchers)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid FK | |
| user_id | uuid FK | |
| subscribed_at | timestamptz | |

---

## 8. FILES

### 8.1 `files`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| storage_path | text | Supabase storage bucket path |
| file_name | text | |
| file_size | bigint | bytes |
| mime_type | text | |
| uploaded_by | uuid FK | |
| uploaded_at | timestamptz | |
| source | enum | `computer`, `webcam`, `link`, `google_drive`, `dropbox`, `box`, `doc` |
| external_url | text | for `link` source |
| thumbnail_url | text | for previews |

### 8.2 `file_attachments`
Polymorphic — files can attach to items, updates, docs.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| file_id | uuid FK | |
| attached_to_type | enum | `item`, `update`, `doc`, `widget` |
| attached_to_id | uuid | the item/update/etc id |
| attached_at | timestamptz | |

---

## 9. UPDATES (Comments / Discussions)

### 9.1 `updates`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid FK | nullable if this is a board-level update |
| board_id | uuid FK | for board-level discussion or denormalized |
| parent_update_id | uuid FK → updates | for replies |
| author_id | uuid FK | |
| content_json | jsonb | rich text (Tiptap / Lexical JSON) |
| content_html | text | rendered cache |
| view_count | int | default 0 |
| created_at | timestamptz | |
| updated_at | timestamptz | (edits) |
| deleted_at | timestamptz | soft |

### 9.2 `update_likes`

| Field | Type | Notes |
|---|---|---|
| update_id | uuid FK | |
| user_id | uuid FK | |
| liked_at | timestamptz | |

> PK: `(update_id, user_id)`

### 9.3 `update_views`

| Field | Type | Notes |
|---|---|---|
| update_id | uuid FK | |
| user_id | uuid FK | |
| viewed_at | timestamptz | |

### 9.4 `update_mentions`

| Field | Type | Notes |
|---|---|---|
| update_id | uuid FK | |
| mentioned_user_id | uuid FK | |
| created_at | timestamptz | |

---

## 10. ACTIVITY LOG

### 10.1 `activity_log`
Single global table. Filtered at read time.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_id | uuid FK → users | nullable if system/automation |
| automation_id | uuid FK | nullable |
| action_type | enum | `item_created`, `item_updated`, `item_deleted`, `item_moved`, `column_changed`, `status_changed`, `group_renamed`, `subscribed`, `update_posted`, `update_replied`, `file_uploaded`, etc. |
| target_type | enum | `account`, `workspace`, `board`, `group`, `item`, `column`, `view`, `automation`, `update` |
| target_id | uuid | |
| board_id | uuid FK | denormalized for board-level filtering |
| item_id | uuid FK | nullable — denormalized for item-level filtering |
| column_id | uuid FK | nullable |
| old_value_jsonb | jsonb | |
| new_value_jsonb | jsonb | |
| context_jsonb | jsonb | additional context (group name, etc.) |
| created_at | timestamptz | |

> No retention limit — unlimited history (we removed Monday's 1-week paywall).

### 10.2 `board_last_viewed` (for "Last Viewed" tab)

| Field | Type | Notes |
|---|---|---|
| board_id | uuid FK | |
| user_id | uuid FK | |
| last_viewed_at | timestamptz | |

> PK: `(board_id, user_id)` — upsert on every view

---

## 11. VIEWS

### 11.1 `views`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| name | text | "Main table", "Kanban", "My Calendar" |
| type | enum | `table`, `kanban`, `calendar`, `gantt`, `chart`, `dashboard`, `form`, `doc`, `file_gallery`, `map`, `workload`, `timeline`, `vibe` |
| sort_order | int | tab order |
| icon | text | |
| is_default | boolean | the "Main" view |
| is_shared | boolean | true = team view, false = personal |
| created_by | uuid FK | |
| settings_jsonb | jsonb | view-specific config (see below) |
| created_at | timestamptz | |

### 11.2 View `settings_jsonb` examples

#### Table
```json
{
  "visible_column_ids": ["uuid1","uuid2"],
  "column_widths": { "uuid1": 200 },
  "pinned_left": ["uuid1"],
  "sort": [{"column_id":"uuid","dir":"asc"}],
  "filters": [...],
  "group_by_column_id": null,
  "item_height": "comfortable"
}
```

#### Kanban (captured from screenshots)
```json
{
  "group_by_column_id": "uuid_of_status_column",
  "card_columns": ["task_code_id", "status_id", "task_type_id", "co_work_time_id"],
  "subtask_card_columns": [...],
  "show_column_name": false,
  "display_cover_image": false
}
```

#### Calendar
```json
{
  "date_column_id": "uuid",
  "view_mode": "month",
  "color_by_column_id": "status_column_uuid"
}
```

#### Gantt
```json
{
  "timeline_column_id": "uuid",
  "show_dependencies": true,
  "show_critical_path": true
}
```

#### Vibe (AI-built)
```json
{
  "prompt": "Show me a dashboard...",
  "generated_html": "<div>...</div>",
  "generated_js": "(function(){...})()",
  "ai_model": "gemini-2.5-pro",
  "generated_at": "2026-05-19T10:00:00Z"
}
```

---

## 12. AUTOMATIONS (V2)

### 12.1 `automations`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | |
| name | text | |
| is_active | boolean | |
| trigger_jsonb | jsonb | { type, column_id, conditions, ... } |
| actions_jsonb | jsonb | array of actions |
| created_by | uuid FK | |
| created_at | timestamptz | |
| last_run_at | timestamptz | |
| run_count | int | |

### 12.2 `automation_runs` (audit)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| automation_id | uuid FK | |
| item_id | uuid FK | nullable |
| status | enum | `success`, `failed`, `skipped` |
| error_message | text | |
| ran_at | timestamptz | |

---

## 13. DASHBOARDS

### 13.1 `dashboards`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| name | text | "New D" |
| privacy | enum | `main`, `private` |
| created_by | uuid FK | |
| created_at | timestamptz | |
| settings_jsonb | jsonb | |

### 13.2 `dashboard_boards` (connect boards)

| Field | Type | Notes |
|---|---|---|
| dashboard_id | uuid FK | |
| board_id | uuid FK | |
| connected_at | timestamptz | |

### 13.3 `dashboard_widgets`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| dashboard_id | uuid FK | |
| widget_type | enum | `chart`, `numbers`, `battery`, `gantt`, `files_gallery`, `timeline`, `calendar`, `apps`, etc. |
| name | text | (editable, defaults from type) |
| settings_jsonb | jsonb | widget config |
| grid_x | int | position on dashboard grid |
| grid_y | int | |
| width | int | grid units |
| height | int | grid units |
| created_at | timestamptz | |

---

## 14. DOCS (Notion-style)

### 14.1 `docs`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| folder_id | uuid FK | nullable |
| board_id | uuid FK | nullable (if attached to a board) |
| item_id | uuid FK | nullable (if attached to a task — "Doc" column or tab) |
| name | text | |
| content_json | jsonb | rich doc tree |
| created_by | uuid FK | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| archived_at | timestamptz | |

---

## 15. FORMS

### 15.1 `forms`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| board_id | uuid FK | submissions create items in this board |
| name | text | |
| description | text | |
| is_public | boolean | shareable URL |
| public_slug | text | for public URL |
| branding_jsonb | jsonb | |
| fields_jsonb | jsonb | which columns to expose + custom labels |
| success_message | text | |
| created_at | timestamptz | |

---

## 16. NOTIFICATIONS

### 16.1 `notifications`

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| recipient_id | uuid FK → users | |
| type | enum | `mention`, `assigned`, `reply`, `status_change`, `item_created`, `update_liked`, `due_date`, `system` |
| actor_id | uuid FK | nullable for system |
| target_type | enum | `item`, `update`, `board`, etc. |
| target_id | uuid | |
| board_id | uuid FK | denormalized |
| message | text | "Arslan assigned you to..." (rendered server-side) |
| is_read | boolean | default false |
| read_at | timestamptz | |
| created_at | timestamptz | |

---

## 17. CUSTOM TASK TABS

### 17.1 `item_tabs`
For the "+" add tab feature on task panel.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| item_id | uuid FK | |
| tab_type | enum | `item_card`, `item_description`, `table`, `chart`, `gantt`, `file_gallery`, `dashboard`, `emails_activities`, `vibe`, `embed` |
| name | text | |
| sort_order | int | |
| settings_jsonb | jsonb | tab-specific config (vibe prompt, embed URL, etc.) |
| created_at | timestamptz | |

---

## 18. AI / GEMINI INTEGRATIONS

### 18.1 `ai_runs`
Log every Gemini API call.

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK | who triggered |
| feature | enum | `sidekick`, `vibe_view`, `suggestions`, `auto_assign_labels`, `summarize`, `magic_solution`, `column_suggest` |
| prompt | text | |
| response | text | |
| model | text | "gemini-2.5-pro", "gemini-2.5-flash" |
| tokens_input | int | |
| tokens_output | int | |
| cost_estimate | numeric | optional tracking |
| target_type | enum | `board`, `item`, `workspace` |
| target_id | uuid | |
| ran_at | timestamptz | |

### 18.2 `ai_agents` (Workspace-level AI agents — saw in Collaborators tab)

| Field | Type | Notes |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK | |
| name | text | |
| title | text | |
| avatar_url | text | |
| system_prompt | text | |
| tools_jsonb | jsonb | which boards/items they can access/modify |
| status | enum | `active`, `paused` |
| owner_id | uuid FK | |
| created_at | timestamptz | |

---

## 19. ARCHIVE / TRASH

### Pattern (across all major tables)
Every major resource (boards, items, groups, columns, docs) has:
- `archived_at timestamptz` — soft archive (recoverable)
- `deleted_at timestamptz` — soft delete (recoverable but hidden from "Archive" view)

Empty `archived_at` and `deleted_at` = active.

---

## 20. KEY INDEXES (for Performance)

- `items.board_id`, `items.group_id`, `items.parent_item_id`
- `item_column_values (item_id, column_id)` unique
- `activity_log (board_id, created_at desc)`
- `activity_log (item_id, created_at desc)`
- `updates (item_id, created_at desc)`
- `notifications (recipient_id, is_read, created_at desc)`
- `views (board_id, sort_order)`
- `columns (board_id, sort_order)`

---

## 21. RLS (Row-Level Security) — Big Picture

Every table gets RLS policies. Examples:

**`boards` SELECT:**
- User is `super_admin` → see all
- User is workspace member AND board is `main` → see
- User is in `board_subscribers` for this board → see
- Else → deny

**`items` INSERT:**
- User is in `board_subscribers` with role `owner` or `member` for the item's board → allow

**`item_column_values` UPDATE:**
- User can edit item (per item permission) → allow

> Full RLS policies will be written as part of the Lovable prompts.

---

## 22. Document Status

| Field | Value |
|---|---|
| **Version** | 0.2 |
| **Status** | Updated — `user_invites` table added |
| **Confirmed by user** | Invite flow schema confirmed |

---

> **Next doc:** `04-mvp-vs-later.md` — what ships in V1 vs V2 vs V3.
