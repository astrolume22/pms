import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute('/_bare')({
  component: BareLayout,
});

function BareLayout() {
  return (
    <div className="min-h-screen bg-app text-text-primary flex flex-col">
      <Outlet />
    </div>
  );
}
