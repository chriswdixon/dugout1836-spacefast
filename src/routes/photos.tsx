import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/photos")({
  staticData: { sitemap: false },
  component: () => <Outlet />,
});
