/**
 * Synthetic Task Code cell — a SLATE-FILL chip.
 *
 * Renders item.task_code ("Task 1", "Task 23", …) centered, white,
 * 13/500 with letter-spacing 0.02em. The slate fill comes from
 * --chip-slate so the whole row reads as a continuous chip band
 * even though Task Code has no semantic color.
 *
 * Click → opens the task panel (matches the comment indicator and the
 * task-name affordance, so users can click into details from any of
 * three places).
 */
interface TaskCodeChipProps {
  code: string;
  onClick: () => void;
}

export function TaskCodeChip({ code, onClick }: TaskCodeChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Open task"
      className="chip-cell chip-cell-center hover:brightness-110 transition-[filter] duration-100"
      style={{ background: 'var(--chip-slate)', letterSpacing: '0.02em' }}
    >
      <span className="truncate">{code}</span>
    </button>
  );
}
