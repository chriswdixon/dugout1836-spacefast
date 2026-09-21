import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { scanPhotosForPlayers } from "@/lib/photo-tags.functions";
import { adminUpdateUser } from "@/lib/users.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useIsAdmin } from "@/hooks/useAuth";
import { listDriveFolders, syncDriveAlbum } from "@/lib/drive.functions";
import { syncGooglePhotosAlbum } from "@/lib/gphotos.functions";
import { decideStagedRecord, removePulledItem, runSourceScan } from "@/lib/sources.functions";
import { seasonOf } from "@/lib/seasons";
import { AdminStats } from "@/routes/_authenticated/stats";
import {
  albumsQuery,
  eventsQuery,
  formatEventDate,
  invitesQuery,
  memberProfilesQuery,
  mediaQuery,
  playersQuery,
  pulledItemsQuery,
  SOURCE_LABEL,
  sourceConfigsQuery,
  stagedQuery,
  syncRunsQuery,
  photoTagsQuery,
} from "@/lib/portal-data";

export const Route = createFileRoute("/_authenticated/admin")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "admin — 1836 - The DugOut" },
      {
        name: "description",
        content:
          "admin dashboard for the 1836 - The DugOut: invite families, add schedule, roster, stats and video, and manage data sources.",
      },
      { property: "og:title", content: "admin — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Manage the 1836 Roughriders portal: invites, schedule, roster, stats, video and sources.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Admin,
});

function Admin() {
  const { user, loading } = useAuth();
  const isAdmin = useIsAdmin(user);

  if (loading || isAdmin.isLoading) {
    return (
      <PortalLayout eyebrow="admin" title="Manage the portal">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </PortalLayout>
    );
  }

  if (isAdmin.data !== true) {
    return (
      <PortalLayout eyebrow="admin" title="Manage the portal">
        <EmptyState
          title="Admin only"
          copy="This dashboard is only available to the team's admin account."
        />
      </PortalLayout>
    );
  }

  return (
    <PortalLayout eyebrow="admin" title="Manage the portal">
      <Tabs defaultValue="invites">

        <TabsList className="flex-wrap">
          <TabsTrigger value="invites">Families</TabsTrigger>

          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="roster">Roster</TabsTrigger>
          <TabsTrigger value="videos">Videos</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="pulls">Pulls</TabsTrigger>
          <TabsTrigger value="stats">Stats</TabsTrigger>

        </TabsList>
        <TabsContent value="invites" className="mt-6">
          <div className="grid gap-12">
            <InvitesPanel />
            <div className="stitch-x opacity-60" />
            <ApprovalsPanel />
          </div>
        </TabsContent>

        <TabsContent value="schedule" className="mt-6">
          <SchedulePanel />
        </TabsContent>
        <TabsContent value="roster" className="mt-6">
          <RosterPanel />
        </TabsContent>
        <TabsContent value="videos" className="mt-6">
          <VideosPanel />
        </TabsContent>
        <TabsContent value="photos" className="mt-6">
          <PhotosPanel />
        </TabsContent>
        <TabsContent value="sources" className="mt-6">
          <SourcesPanel />
        </TabsContent>
        <TabsContent value="pulls" className="mt-6">
          <PullsPanel />
        </TabsContent>
        <TabsContent value="stats" className="mt-6">
          <StatsPanel />
        </TabsContent>

      </Tabs>
    </PortalLayout>
  );
}

function StatsPanel() {
  return <AdminStats />;
}

function useInvalidate(key: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [key] });
}

function personLabel(p: { full_name: string | null; email: string | null } | undefined) {
  if (!p) return "Signed up on their own";
  return p.full_name ?? p.email ?? "A family";
}

/** Dialog letting the admin fix a member's name and sign-in email. */
function EditUserDialog({
  person,
  open,
  onOpenChange,
}: {
  person: { id: string; full_name: string | null; email: string | null } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useInvalidate("profiles");
  const [name, setName] = useState(person?.full_name ?? "");
  const [email, setEmail] = useState(person?.email ?? "");

  // Reset the fields whenever a different person is opened.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (person && person.id !== loadedFor) {
    setLoadedFor(person.id);
    setName(person.full_name ?? "");
    setEmail(person.email ?? "");
  }

  const save = useMutation({
    mutationFn: async () => {
      const trimmed = email.trim();
      if (!trimmed) throw new Error("An email is required");
      return adminUpdateUser({
        data: { id: person!.id, full_name: name.trim() || null, email: trimmed },
      });
    },
    onSuccess: () => {
      toast.success("Details updated");
      invalidate();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit family details</DialogTitle>
          <DialogDescription>
            Update their display name and the email they sign in with.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sarah Burnett"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-email">Sign-in email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** New sign-ups wait here until the admin lets them in. */
function ApprovalsPanel() {
  const { user } = useAuth();
  const isAdmin = useIsAdmin(user);
  const people = useQuery({ ...memberProfilesQuery, refetchInterval: 5000 });
  const invites = useQuery({ ...invitesQuery, refetchInterval: 5000 });
  const invalidate = useInvalidate("profiles");
  const [editing, setEditing] = useState<
    { id: string; full_name: string | null; email: string | null } | null
  >(null);

  const decide = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "approved" | "declined" }) => {
      const { error } = await supabase
        .from("profiles")
        .update({
          status,
          approved_by: user?.id ?? null,
          approved_at: status === "approved" ? new Date().toISOString() : null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.status === "approved" ? "Approved — they're in" : "Declined");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = people.data ?? [];
  const byId = new Map(rows.map((p) => [p.id, p]));
  const pending = rows.filter((p) => p.status === "pending");
  const approved = rows.filter((p) => p.status === "approved");
  const declined = rows.filter((p) => p.status === "declined");
  const inviterOf = (id: string) => {
    const p = byId.get(id);
    if (p?.invited_by) return personLabel(byId.get(p.invited_by));
    const inv = (invites.data ?? []).find(
      (i) => i.email?.toLowerCase() === (p?.email ?? "").toLowerCase(),
    );
    if (inv?.invited_by) return personLabel(byId.get(inv.invited_by));
    return "Signed up on their own";
  };

  const Row = ({
    p,
    children,
  }: {
    p: (typeof rows)[number];
    children?: ReactNode;
  }) => (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="font-medium">{p.full_name ?? p.email ?? "New family"}</p>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          {p.email ?? "—"} · Invited by {inviterOf(p.id)}
        </p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </li>
  );

  return (
    <div className="grid gap-8">
      <div>
        <h2 className="font-display text-lg uppercase tracking-wide">Waiting for approval</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAdmin.data === true
            ? "New sign-ups can't see anything until you approve them."
            : "Only the team's admin account can approve new sign-ups."}
        </p>
        <div className="mt-4">
          {pending.length === 0 ? (
            <EmptyState title="Nobody is waiting" />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {pending.map((p) => (
                <Row key={p.id} p={p}>
                  {isAdmin.data === true ? (
                    <>
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: p.id, status: "approved" })}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: p.id, status: "declined" })}
                      >
                        Decline
                      </Button>
                    </>
                  ) : (
                    <span className="text-xs uppercase tracking-widest text-muted-foreground">
                      Pending
                    </span>
                  )}
                </Row>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div>
        <h2 className="font-display text-lg uppercase tracking-wide">
          Approved families ({approved.length})
        </h2>
        <div className="mt-4">
          {approved.length === 0 ? (
            <EmptyState title="No families yet" />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {approved.map((p) => (
                <Row key={p.id} p={p}>
                  {isAdmin.data === true ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: p.id, status: "declined" })}
                      >
                        Remove access
                      </Button>
                    </>
                  ) : null}
                </Row>
              ))}
            </ul>
          )}
        </div>
      </div>

      {declined.length > 0 ? (
        <div>
          <h2 className="font-display text-lg uppercase tracking-wide">Declined</h2>
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {declined.map((p) => (
                <Row key={p.id} p={p}>
                  {isAdmin.data === true ? (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        disabled={decide.isPending}
                        onClick={() => decide.mutate({ id: p.id, status: "approved" })}
                      >
                        Approve
                      </Button>
                    </>
                  ) : null}
                </Row>
              ))}
            </ul>
          </div>
        ) : null}

        <EditUserDialog person={editing} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      </div>
    );
}


function InvitesPanel() {
  const { user } = useAuth();
  const invites = useQuery(invitesQuery);
  const invalidate = useInvalidate("invites");
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("invites")
        .insert({ email: email.trim().toLowerCase(), label: label.trim() || null, invited_by: user?.id ?? null });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Family added to the invite list");
      setEmail("");
      setLabel("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invites").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  const makeCode = () => {
    // 10-char unguessable code (no ambiguous 0/O/1/I/L characters)
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  };

  const generate = useMutation({
    mutationFn: async () => {
      // retry in the unlikely case the code already exists
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = makeCode();
        const { error } = await supabase.from("invites").insert({
          code,
          label: label.trim() || null,
          invited_by: user?.id ?? null,
        });
        if (!error) return code;
        if (!String(error.message).includes("invites_code_key")) throw error;
      }
      throw new Error("Couldn't make a fresh code — try again");
    },
    onSuccess: (code) => {
      toast.success(`Invite code ${code} created`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Couldn't copy — select the code and copy it yourself");
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[20rem_1fr]">
      <form
        className="panel space-y-4 rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 className="font-display text-lg uppercase tracking-wide">Invite a family</h2>
        <div className="space-y-2">
          <Label htmlFor="inv-email">Parent email</Label>
          <Input id="inv-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-label">Player or family name</Label>
          <Input id="inv-label" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={add.isPending}>
          Add to list
        </Button>
        <p className="text-xs text-muted-foreground">
          Only emails on this list can see team content after they create an account.
        </p>
        <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
        >
          Generate an invite code
        </Button>
        <p className="text-xs text-muted-foreground">
          Share the code with anyone — they enter it when creating their account and are linked to
          you.
        </p>
      </form>

      <div>
        {(invites.data ?? []).length === 0 ? (
          <EmptyState title="No families on the list yet" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(invites.data ?? []).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{i.email ?? i.code}</p>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {i.label ?? "—"} · {i.accepted_at ? "Signed up" : i.code ? "Code ready" : "Invited"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {i.code ? (
                    <Button variant="outline" size="sm" onClick={() => copyCode(i.code!)}>
                      Copy code
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(i.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SchedulePanel() {
  const events = useQuery(eventsQuery);
  const invalidate = useInvalidate("events");
  const [form, setForm] = useState({
    title: "",
    event_type: "game",
    starts_at: "",
    location: "",
    opponent: "",
    notes: "",
    link_url: "",
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("events").insert({
        title: form.title || null,
        event_type: form.event_type,
        starts_at: new Date(form.starts_at).toISOString(),
        location: form.location || null,
        opponent: form.opponent || null,
        notes: form.notes || null,
        link_url: form.link_url || null,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Event added");
      setForm({ title: "", event_type: "game", starts_at: "", location: "", opponent: "", notes: "", link_url: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("events").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <form
        className="panel space-y-4 rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 className="font-display text-lg uppercase tracking-wide">Add an event</h2>
        <div className="space-y-2">
          <Label htmlFor="ev-title">Title</Label>
          <Input id="ev-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-type">Type</Label>
          <Input
            id="ev-type"
            value={form.event_type}
            onChange={(e) => setForm({ ...form, event_type: e.target.value })}
            placeholder="game, tournament, practice"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-date">Date and time</Label>
          <Input
            id="ev-date"
            type="datetime-local"
            required
            value={form.starts_at}
            onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-opp">Opponent</Label>
          <Input id="ev-opp" value={form.opponent} onChange={(e) => setForm({ ...form, opponent: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-loc">Location</Label>
          <Input id="ev-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-link">Link (optional)</Label>
          <Input id="ev-link" value={form.link_url} onChange={(e) => setForm({ ...form, link_url: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-notes">Notes</Label>
          <Textarea id="ev-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>
        <Button type="submit" className="w-full" disabled={add.isPending}>
          Add event
        </Button>
      </form>

      <div>
        {(events.data ?? []).length === 0 ? (
          <EmptyState title="No events yet" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(events.data ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">{e.title ?? e.opponent ?? "Game"}</p>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString()} · {SOURCE_LABEL[e.source] ?? e.source}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(e.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RosterPanel() {
  const players = useQuery(playersQuery);
  const invalidate = useInvalidate("players");
  const [form, setForm] = useState({
    name: "",
    jersey_number: "",
    positions: "",
    grad_year: "",
    bats: "",
    throws: "",
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("players").insert({
        name: form.name,
        jersey_number: form.jersey_number || null,
        positions: form.positions || null,
        grad_year: form.grad_year ? Number(form.grad_year) : null,
        bats: form.bats || null,
        throws: form.throws || null,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Player added");
      setForm({ name: "", jersey_number: "", positions: "", grad_year: "", bats: "", throws: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <form
        className="panel space-y-4 rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 className="font-display text-lg uppercase tracking-wide">Add a player</h2>
        <div className="space-y-2">
          <Label htmlFor="pl-name">Name</Label>
          <Input id="pl-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="pl-num">Number</Label>
            <Input
              id="pl-num"
              value={form.jersey_number}
              onChange={(e) => setForm({ ...form, jersey_number: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pl-grad">Grad year</Label>
            <Input
              id="pl-grad"
              value={form.grad_year}
              onChange={(e) => setForm({ ...form, grad_year: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pl-pos">Positions</Label>
          <Input
            id="pl-pos"
            value={form.positions}
            onChange={(e) => setForm({ ...form, positions: e.target.value })}
            placeholder="SS / RHP"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="pl-bats">Bats</Label>
            <Input id="pl-bats" value={form.bats} onChange={(e) => setForm({ ...form, bats: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pl-throws">Throws</Label>
            <Input id="pl-throws" value={form.throws} onChange={(e) => setForm({ ...form, throws: e.target.value })} />
          </div>
        </div>
        <Button type="submit" className="w-full" disabled={add.isPending}>
          Add player
        </Button>
      </form>

      <div>
        {(players.data ?? []).length === 0 ? (
          <EmptyState title="No players yet" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(players.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="font-medium">
                    {p.jersey_number ? `#${p.jersey_number} ` : ""}
                    {p.name}
                  </p>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {p.positions ?? "—"}
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(p.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function VideosPanel() {
  const media = useQuery(mediaQuery);
  const invalidate = useInvalidate("media_items");
  const [form, setForm] = useState({ title: "", media_url: "", kind: "video", description: "" });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("media_items").insert({
        title: form.title,
        media_url: form.media_url,
        kind: form.kind,
        description: form.description || null,
        source: "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Video added");
      setForm({ title: "", media_url: "", kind: "video", description: "" });
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("media_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr]">
      <form
        className="panel space-y-4 rounded-lg p-5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <h2 className="font-display text-lg uppercase tracking-wide">Add a video</h2>
        <div className="space-y-2">
          <Label htmlFor="md-title">Title</Label>
          <Input id="md-title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="md-url">Video link</Label>
          <Input
            id="md-url"
            required
            value={form.media_url}
            onChange={(e) => setForm({ ...form, media_url: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="md-desc">Description</Label>
          <Textarea
            id="md-desc"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <Button type="submit" className="w-full" disabled={add.isPending}>
          Add video
        </Button>
      </form>

      <div>
        {(media.data ?? []).length === 0 ? (
          <EmptyState title="No videos yet" />
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(media.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.title}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.media_url}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourcesPanel() {
  const sources = useQuery(sourceConfigsQuery);
  const invalidate = useInvalidate("source_configs");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: async ({ id, url }: { id: string; url: string }) => {
      const { error } = await supabase.from("source_configs").update({ url: url || null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Saved");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-muted-foreground">
        Save the team's page link for each service. Automatic pulls use these links; anything the
        service won't share can still be typed in on the other tabs.
      </p>
      {(sources.data ?? []).map((s) => (
        <div key={s.id} className="rounded-lg border border-border bg-card p-4">
          <p className="font-display text-base uppercase tracking-wide">
            {SOURCE_LABEL[s.source] ?? s.source}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input
              value={drafts[s.id] ?? s.url ?? ""}
              onChange={(e) => setDrafts({ ...drafts, [s.id]: e.target.value })}
              placeholder="https://…"
              className="min-w-[16rem] flex-1"
            />
            <Button
              variant="outline"
              onClick={() => save.mutate({ id: s.id, url: drafts[s.id] ?? s.url ?? "" })}
            >
              Save
            </Button>
          </div>
          {s.last_run_at ? (
            <p className="mt-2 text-xs uppercase tracking-widest text-muted-foreground">
              Last pull {new Date(s.last_run_at).toLocaleString()}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PhotosPanel() {
  const qc = useQueryClient();
  const albums = useQuery(albumsQuery);
  const folders = useQuery({
    queryKey: ["drive-folders"],
    queryFn: () => listDriveFolders({}),
    retry: false,
  });
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [gphotosUrl, setGphotosUrl] = useState(
    "https://photos.app.goo.gl/eTjkzm4v4YBx5q2G6"
  );

  const syncGPhotos = useMutation({
    mutationFn: (input: { url: string; title?: string; description?: string }) =>
      syncGooglePhotosAlbum({ data: input }),
    onSuccess: (res: { photoCount: number }) => {
      toast.success(`Google Photos album updated with ${res.photoCount} photos.`);
      void qc.invalidateQueries({ queryKey: albumsQuery.queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sync = useMutation({
    mutationFn: (input: { folder: string; title?: string; description?: string }) =>
      syncDriveAlbum({ data: input }),
    onSuccess: (res: { photoCount: number }) => {
      toast.success(`Album updated with ${res.photoCount} photos.`);
      setFolder("");
      setTitle("");
      setDescription("");
      void qc.invalidateQueries({ queryKey: albumsQuery.queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="panel space-y-4 rounded-xl p-6">
        <h3 className="section-title text-lg">Team album — Google Photos</h3>
        <p className="text-sm text-muted-foreground">
          The Fall 2026 team album lives in Google Photos. Refresh it here whenever new
          photos are added.
        </p>
        <div className="space-y-2">
          <Label htmlFor="gphotos-url">Google Photos album link</Label>
          <Input
            id="gphotos-url"
            value={gphotosUrl}
            onChange={(e) => setGphotosUrl(e.target.value)}
            placeholder="https://photos.app.goo.gl/…"
          />
        </div>
        <Button
          disabled={syncGPhotos.isPending || !gphotosUrl.trim()}
          onClick={() =>
            syncGPhotos.mutate({
              url: gphotosUrl.trim(),
              title: "Fall 2026",
              description: "1836 RoughRiders 15u Coach Burnett — Fall 2026 team album.",
            })
          }
        >
          {syncGPhotos.isPending ? "Syncing…" : "Refresh team album"}
        </Button>
      </div>

      <div className="panel space-y-4 rounded-xl p-6">
        <h3 className="section-title text-lg">Add or refresh a Drive album</h3>
        <div className="space-y-2">
          <Label htmlFor="folder">Google Drive folder link or ID</Label>
          <Input
            id="folder"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="album-title">Album name (optional)</Label>
          <Input id="album-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="album-desc">Description (optional)</Label>
          <Textarea
            id="album-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <Button
          disabled={sync.isPending || !folder.trim()}
          onClick={() =>
            sync.mutate({
              folder: folder.trim(),
              ...(title.trim() ? { title: title.trim() } : {}),
              ...(description.trim() ? { description: description.trim() } : {}),
            })
          }
        >
          {sync.isPending ? "Syncing…" : "Sync album"}
        </Button>
        <div className="space-y-2 border-t border-border pt-4">
          <p className="eyebrow">Folders in the connected drive</p>
          {folders.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading folders…</p>
          ) : folders.isError ? (
            <p className="text-sm text-muted-foreground">
              Could not read the drive right now. You can still paste a folder link above.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(folders.data ?? []).map((f) => (
                <Button key={f.id} variant="outline" size="sm" onClick={() => setFolder(f.id)}>
                  {f.name}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="panel space-y-3 rounded-xl p-6">
        <h3 className="section-title text-lg">Albums</h3>
        <p className="text-sm text-muted-foreground">
          Give each album a season, and link it to a game so its photos show on that game's page.
        </p>
        {(albums.data ?? []).length === 0 ? (
          <EmptyState title="No albums yet" copy="Sync a Drive folder to publish photos." />
        ) : (
          (albums.data ?? []).map((a) => (
            <div key={a.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs uppercase tracking-widest text-muted-foreground">
                    {a.photo_count ?? 0} photos
                    {a.last_synced_at
                      ? ` · synced ${new Date(a.last_synced_at).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                {a.gphotos_url ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={syncGPhotos.isPending}
                    onClick={() => syncGPhotos.mutate({ url: a.gphotos_url! })}
                  >
                    Refresh
                  </Button>
                ) : a.drive_folder_id ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sync.isPending}
                    onClick={() => sync.mutate({ folder: a.drive_folder_id! })}
                  >
                    Refresh
                  </Button>
                ) : null}
              </div>
              <AlbumFiling album={a} />
            </div>
          ))
        )}
      </div>

      <TaggingPanel />
    </div>
  );
}

function TaggingPanel() {
  const qc = useQueryClient();
  const tags = useQuery(photoTagsQuery);
  const [last, setLast] = useState<string | null>(null);

  const scan = useMutation({
    mutationFn: () => scanPhotosForPlayers({ data: { limit: 10 } }),
    onSuccess: (res: { scanned: number; tagged: number; needsManual: number; remaining: number }) => {
      setLast(
        `Looked at ${res.scanned} photos · ${res.tagged} players identified · ${res.needsManual} need a name by hand · ${res.remaining} photos left to check`,
      );
      toast.success(`${res.tagged} players identified.`);
      void qc.invalidateQueries({ queryKey: photoTagsQuery.queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="panel space-y-3 rounded-xl p-6">
      <h3 className="section-title text-lg">Identify players in photos</h3>
      <p className="text-sm text-muted-foreground">
        The AI reads jersey numbers and tags the matching player from the roster. When a number
        is not visible, the photo is left for someone to name the player by hand — open the photo
        and use “Identify a player”.
      </p>
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        {(tags.data ?? []).length} tags so far
      </p>
      <Button disabled={scan.isPending} onClick={() => scan.mutate()}>
        {scan.isPending ? "Looking at photos…" : "Check the next 10 photos"}
      </Button>
      {last ? <p className="text-sm text-muted-foreground">{last}</p> : null}
    </div>
  );
}

function AlbumFiling({
  album,
}: {
  album: { id: string; season: string | null; event_id: string | null; created_at: string };
}) {
  const qc = useQueryClient();
  const events = useQuery(eventsQuery);
  const [season, setSeason] = useState(album.season ?? seasonOf(album.created_at));
  const [eventId, setEventId] = useState(album.event_id ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("albums")
        .update({ season: season.trim() || null, event_id: eventId || null })
        .eq("id", album.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Album filed.");
      void qc.invalidateQueries({ queryKey: albumsQuery.queryKey });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <div className="space-y-1">
        <Label htmlFor={`season-${album.id}`}>Season</Label>
        <Input
          id={`season-${album.id}`}
          value={season}
          onChange={(e) => setSeason(e.target.value)}
          placeholder="Fall 2026"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor={`game-${album.id}`}>Game (optional)</Label>
        <select
          id={`game-${album.id}`}
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Not tied to a game</option>
          {(events.data ?? [])
            .slice()
            .sort((a, b) => new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime())
            .map((e) => (
              <option key={e.id} value={e.id}>
                {formatEventDate(e.starts_at)} · {e.opponent ?? e.title ?? "Game"}
              </option>
            ))}
        </select>
      </div>
      <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Saving…" : "Save"}
      </Button>
    </div>
  );
}

const PULL_SOURCES = [
  { key: "gamechanger", label: "GameChanger" },
  { key: "fivetools", label: "FiveTool" },
  { key: "perfect_game", label: "Perfect Game" },
] as const;

// The automatic sync runs daily at 11:00 UTC (6:00am Central).
const SYNC_HOUR_UTC = 11;

function nextSyncAt() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), SYNC_HOUR_UTC, 0, 0),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function nextSyncLabel() {
  return nextSyncAt().toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function nextSyncCountdown() {
  const mins = Math.max(0, Math.round((nextSyncAt().getTime() - Date.now()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in about ${h}h ${m}m` : `in about ${m}m`;
}

function PullsPanel() {

  const qc = useQueryClient();
  const staged = useQuery(stagedQuery);
  const published = useQuery(pulledItemsQuery);
  const runs = useQuery(syncRunsQuery);
  const [running, setRunning] = useState<string | null>(null);

  const refreshAll = () => {
    void qc.invalidateQueries({ queryKey: stagedQuery.queryKey });
    void qc.invalidateQueries({ queryKey: pulledItemsQuery.queryKey });
    void qc.invalidateQueries({ queryKey: syncRunsQuery.queryKey });
    void qc.invalidateQueries({ queryKey: sourceConfigsQuery.queryKey });
    void qc.invalidateQueries({ queryKey: eventsQuery.queryKey });
  };

  const scan = useMutation({
    mutationFn: (source: (typeof PULL_SOURCES)[number]["key"]) => runSourceScan({ data: { source } }),
    onMutate: (source) => setRunning(source),
    onSettled: () => setRunning(null),
    onSuccess: (res: { events: number; stats: number; published: number }) => {
      toast.success(
        res.published === 0
          ? "Nothing new found on that page."
          : `Added ${res.events} game/event entries and ${res.stats} stat lines to the portal.`,
      );
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; approve: boolean }) => decideStagedRecord({ data: input }),
    onSuccess: refreshAll,
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removePulledItem({ data: { id } }),
    onSuccess: () => {
      toast.success("Taken off the portal.");
      refreshAll();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const leftovers = staged.data ?? [];

  return (
    <div className="space-y-6">
      <div className="panel space-y-4 rounded-xl p-6">
        <h3 className="section-title text-lg">Automatic updates</h3>
        <p className="text-sm text-muted-foreground">
          Games, results and stats from GameChanger, FiveTool and Perfect Game are checked
          automatically once a day at 6:00am Central and go straight onto the portal — no approving
          needed. Repeat checks update the same entries instead of duplicating them. You can also
          check now, and remove anything that came in wrong.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Next check</p>
            <p className="font-medium">{nextSyncLabel()}</p>
            <p className="text-xs text-muted-foreground">{nextSyncCountdown()}</p>
          </div>
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Last check</p>
            <p className="font-medium">
              {runs.data?.[0]
                ? new Date(runs.data[0].started_at).toLocaleString()
                : "Not run yet"}
            </p>
            <p className="text-xs text-muted-foreground">
              {runs.data?.[0]
                ? `${SOURCE_LABEL[runs.data[0].source] ?? runs.data[0].source} · ${runs.data[0].status === "failed" ? "had a problem" : "completed"}`
                : "The first automatic check runs at the next scheduled time."}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {PULL_SOURCES.map((s) => (
            <Button
              key={s.key}
              variant="outline"
              disabled={scan.isPending}
              onClick={() => scan.mutate(s.key)}
            >
              {running === s.key ? "Checking…" : `Check ${s.label} now`}
            </Button>
          ))}
        </div>
      </div>

      <div className="panel space-y-3 rounded-xl p-6">
        <h3 className="section-title text-lg">Recent checks</h3>
        {(runs.data ?? []).length === 0 ? (
          <EmptyState title="No checks yet" copy="The first automatic check runs shortly." />
        ) : (
          (runs.data ?? []).map((run) => (
            <div
              key={run.id}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <span className="font-medium">{SOURCE_LABEL[run.source] ?? run.source}</span>
              <span className="text-muted-foreground">
                {new Date(run.started_at).toLocaleString()} ·{" "}
                {run.status === "failed"
                  ? `Could not read the page — ${run.message ?? "unknown problem"}`
                  : (run.message ?? `${run.items_found ?? 0} item(s)`)}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="panel space-y-3 rounded-xl p-6">
        <h3 className="section-title text-lg">Added automatically</h3>
        {(published.data ?? []).length === 0 ? (
          <EmptyState
            title="Nothing added yet"
            copy="Anything found on those sites shows up here once it is live on the portal."
          />
        ) : (
          (published.data ?? []).map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-4">
              <p className="eyebrow">
                {SOURCE_LABEL[row.source] ?? row.source} · {row.kind === "event" ? "Game" : "Stats"}
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {JSON.stringify(row.payload, null, 2)}
              </pre>
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(row.id)}
                >
                  Remove from portal
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {leftovers.length > 0 && (
        <div className="panel space-y-3 rounded-xl p-6">
          <h3 className="section-title text-lg">Left over from earlier reviews</h3>
          {leftovers.map((row) => (
            <div key={row.id} className="rounded-lg border border-border p-4">
              <p className="eyebrow">
                {SOURCE_LABEL[row.source] ?? row.source} · {row.kind === "event" ? "Game" : "Stats"}
              </p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                {JSON.stringify(row.payload, null, 2)}
              </pre>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: row.id, approve: true })}
                >
                  Publish
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ id: row.id, approve: false })}
                >
                  Discard
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
