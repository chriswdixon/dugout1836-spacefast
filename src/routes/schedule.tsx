import { createFileRoute, redirect } from "@tanstack/react-router";

/** The schedule now lives on the calendar screen. */
export const Route = createFileRoute("/schedule")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ to: "/calendar" });
  },
});
