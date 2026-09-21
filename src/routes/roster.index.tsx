import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Camera } from "lucide-react";

import { PortalLayout } from "@/components/PortalLayout";
import { EmptyState } from "@/components/EmptyState";
import { photoTagsQuery, playersQuery, playerTagPhotosQuery } from "@/lib/portal-data";

export const Route = createFileRoute("/roster/")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "Roster — 1836 - The DugOut" },
      {
        name: "description",
        content: "Meet the 1836 Roughriders — tap a player to see their photos and videos.",
      },
      { property: "og:title", content: "Roster — 1836 - The DugOut" },
      {
        property: "og:description",
        content: "Meet the 1836 Roughriders — tap a player to see their photos and videos.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Roster,
});

function initials(name: string) {
  const parts = name.split(" ").filter(Boolean);
  return parts.slice(0, 2).map((n) => n[0]).join("").toUpperCase();
}

function Roster() {
  const { data: players, isLoading: playersLoading } = useQuery(playersQuery);
  const { data: tags, isLoading: tagsLoading } = useQuery(photoTagsQuery);
  const { data: tagPhotos } = useQuery(playerTagPhotosQuery);

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tags ?? []) {
      map.set(t.player_id, (map.get(t.player_id) ?? 0) + 1);
    }
    return map;
  }, [tags]);

  const isLoading = playersLoading || tagsLoading;
  const roster = players ?? [];

  return (
    <PortalLayout eyebrow="The team" title="Roster">
      {isLoading ? (
        <p className="text-sm opacity-60">Loading…</p>
      ) : roster.length === 0 ? (
        <EmptyState
          title="No players yet"
          copy="The roster shows up here once players are added in the admin area."
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {roster.map((p) => {
            const appearances = tagCounts.get(p.id) ?? 0;
            const photo = p.photo_url ?? tagPhotos?.get(p.id) ?? null;
            return (
              <Link
                key={p.id}
                to="/roster/$playerId"
                params={{ playerId: p.id }}
                className="group overflow-hidden rounded-[20px] border border-ink/10 bg-white/50 transition-all hover:border-ink/30 hover:shadow-sm"
              >
                <div className="relative aspect-[4/5] overflow-hidden bg-ink/5">
                  {photo ? (
                    <img
                      src={photo}
                      alt={p.name}
                      loading="lazy"
                      className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex size-full items-center justify-center bg-paper">
                      <span className="font-print text-5xl text-ink/20 uppercase">
                        {initials(p.name)}
                      </span>
                    </div>
                  )}
                  <div className="absolute left-4 top-4 flex items-center gap-2">
                    {p.jersey_number ? (
                      <span className="rounded-full bg-paper px-3 py-1 text-[10px] font-bold tracking-widest text-ink uppercase shadow-sm">
                        #{p.jersey_number}
                      </span>
                    ) : null}
                  </div>
                  <div className="absolute bottom-4 right-4">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-[10px] font-bold tracking-widest text-paper uppercase backdrop-blur-sm">
                      <Camera className="size-3" />
                      {appearances} photo{appearances === 1 ? "" : "s"}
                    </span>
                  </div>
                </div>
                <div className="p-5">
                  <h3 className="font-print text-2xl uppercase leading-none tracking-tight">
                    {p.name}
                  </h3>
                  <p className="mt-2 text-sm text-ink/70">
                    {[p.positions, p.grad_year ? `Class of ${p.grad_year}` : null]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                  {p.bats || p.throws ? (
                    <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-seam">
                      B/T {p.bats ?? "-"}/{p.throws ?? "-"}
                    </p>
                  ) : null}
                  <span className="mt-5 inline-block border-b border-ink/30 pb-1 text-[10px] font-bold tracking-widest uppercase transition-colors group-hover:border-seam group-hover:text-seam">
                    See appearances →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </PortalLayout>
  );
}
