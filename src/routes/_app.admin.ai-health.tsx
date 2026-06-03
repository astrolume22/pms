/**
 * /admin/ai-health — AI engine status + recent runs.
 *
 * Stacks the existing AiHealthSection (status pings) above AiRunsSection
 * (run history). These two were always shown together at the bottom of
 * the old single /admin page and read as one job; keeping them on one
 * page preserves that.
 */
import { createFileRoute } from '@tanstack/react-router';
import { AiHealthSection } from '@/components/admin/AiHealthSection';
import { AiRunsSection } from '@/components/admin/AiRunsSection';

export const Route = createFileRoute('/_app/admin/ai-health')({
  component: AiHealthPage,
});

function AiHealthPage() {
  return (
    <>
      <AiHealthSection />
      <AiRunsSection />
    </>
  );
}
