import { createFileRoute, redirect } from "@tanstack/react-router";

/** The dashboard is now the public homepage. */
export const Route = createFileRoute("/dashboard")({
  staticData: { sitemap: false },
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
