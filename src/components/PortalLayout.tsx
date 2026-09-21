import { Link, Navigate, useRouter } from "@tanstack/react-router";
import { Clock, LogOut, Menu, Shield } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin, useMyStatus } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";


const NAV = [
  { to: "/", label: "Home" },
  { to: "/calendar", label: "Schedule" },

  
  { to: "/roster", label: "Roster" },
  { to: "/photos", label: "Photos & Videos" },
  { to: "/share", label: "Share" },
] as const;

export function BaseballIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      {/* the two curved seams */}
      <path d="M6.2 4.6c2.2 2 2.2 12.8 0 14.8" strokeDasharray="1.5 2.2" />
      <path d="M17.8 4.6c-2.2 2-2.2 12.8 0 14.8" strokeDasharray="1.5 2.2" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-print text-3xl leading-none text-ticket">1836</span>
      <span className="font-work text-[11px] font-bold uppercase tracking-[0.22em] text-foreground">
        The DugOut
      </span>
    </span>
  );
}

export function PortalLayout({
  children,
  title,
  eyebrow,
  actions,
  fitScreen,
  requireAuth,
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  actions?: ReactNode;
  /** Hide the footer on large screens so the page fits the viewport. */
  fitScreen?: boolean;
  /** Redirect signed-out visitors to the sign-in page. */
  requireAuth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const isAdmin = useIsAdmin(user);
  const status = useMyStatus(user);
  const waiting = !!user && status.data !== undefined && status.data !== "approved";
  const blocked = !!requireAuth && (authLoading || !user);

  const router = useRouter();


  const signOut = async () => {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/" className="shrink-0">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {(waiting ? [] : NAV).map((item) => (

              <Link
                key={item.to}
                to={item.to}
                className="rounded-md px-3 py-2 font-work text-[11px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                activeProps={{ className: "bg-secondary text-primary" }}
              >
                {item.label}
              </Link>
            ))}
            {isAdmin.data === true && !waiting ? (
              <Link
                to="/admin"
                className="ml-1 flex items-center gap-1 rounded-md px-3 py-2 font-work text-[11px] font-bold uppercase tracking-[0.18em] text-primary transition-colors hover:bg-secondary"
                activeProps={{ className: "bg-secondary" }}
              >
                <Shield className="size-3.5" /> admin
              </Link>
            ) : null}


            {user ? (
              <Button variant="ghost" size="sm" onClick={signOut} className="ml-2">
                <LogOut className="size-4" />
              </Button>
            ) : (
              <Button asChild variant="outline" size="sm" className="ml-2 rounded-[20px]">
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
          </nav>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
          >
            <Menu className="size-5" />
          </Button>
        </div>
        {open ? (
          <nav className="grid gap-1 border-t border-border px-4 py-3 md:hidden">
            {(waiting ? [] : NAV).map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 font-work text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground"
                activeProps={{ className: "bg-secondary text-primary" }}
              >
                {item.label}
              </Link>
            ))}
            {isAdmin.data === true && !waiting ? (
              <Link
                to="/admin"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 font-work text-xs font-bold uppercase tracking-[0.18em] text-primary"
              >
                admin
              </Link>
            ) : null}


            {user ? (
              <button
                onClick={signOut}
                className="rounded-md px-3 py-2 text-left font-work text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/auth"
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 font-work text-xs font-bold uppercase tracking-[0.18em] text-primary"
              >
                Sign in
              </Link>
            )}
          </nav>
        ) : null}
        <div className="stitch-x opacity-60" />
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {title ? (
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
              <h1 className={cn("section-title text-3xl md:text-4xl")}>{title}</h1>
            </div>
            {actions}
          </div>
        ) : null}
        {blocked ? (
          authLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
          ) : (
            <Navigate to="/auth" replace />
          )
        ) : waiting ? (
          <div className="panel mx-auto max-w-lg rounded-lg p-8 text-center">
            <Clock className="mx-auto size-8 text-primary" />
            <h2 className="mt-4 font-display text-2xl uppercase tracking-wide">
              {status.data === "declined" ? "Access not approved" : "Waiting for approval"}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {status.data === "declined"
                ? "This account wasn't approved for the team portal. Ask the person who invited you if you think that's a mistake."
                : "Your account is signed up. A team admin needs to approve it before you can see photos, schedules and everything else. You'll get in as soon as they do."}
            </p>
            <Button variant="outline" className="mt-6" onClick={signOut}>
              Sign out
            </Button>
          </div>
        ) : (
          children
        )}

      </main>

      <footer className={`py-6 text-center text-xs text-muted-foreground${fitScreen ? " lg:hidden" : ""}`}>
        <div className="stitch-x mb-6 opacity-60" />
        <span className="inline-flex items-center gap-2">
          <span className="diamond-dot" aria-hidden />
          1836 - The DugOut — for Roughriders families
          <span className="diamond-dot" aria-hidden />
        </span>
      </footer>
    </div>
  );
}
