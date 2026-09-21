import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Wordmark } from "@/components/PortalLayout";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Reset password — 1836 - The DugOut" },
      { name: "description", content: "Set a new password for the 1836 Roughriders family portal." },
      { property: "og:title", content: "Reset password — 1836 - The DugOut" },
      { property: "og:description", content: "Set a new password for the 1836 Roughriders family portal." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Reset links carry a one-time token: /reset-password?token=…
    const token = new URLSearchParams(window.location.search).get("token");
    if (token) setReady(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("Passwords don't match.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Password updated. Sign in with your new password.");
    router.navigate({ to: "/auth" });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header>
        <div className="mx-auto flex h-16 max-w-6xl items-center px-4">
          <Link to="/">
            <Wordmark />
          </Link>
        </div>
        <div className="stitch-x opacity-60" />
      </header>

      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="panel w-full max-w-md rounded-xl p-6">
          <p className="eyebrow">Account recovery</p>
          <h1 className="section-title mt-2 text-2xl">Set a new password</h1>

          {ready ? (
            <form onSubmit={submit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input
                  id="new-password"
                  type="password"
                  minLength={6}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  minLength={6}
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Saving…" : "Save new password"}
              </Button>
            </form>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">
              This page only works from the reset link in your email. If the link expired,
              request a new one from the{" "}
              <Link to="/auth" className="underline underline-offset-2">
                sign in page
              </Link>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
