import { Play, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SOURCE_LABEL, type TeamVideo } from "@/lib/portal-data";

type Props = {
  videos: TeamVideo[];
  /** When set, each card shows a remove button. */
  onRemove?: (video: TeamVideo) => void;
  removing?: boolean;
};

/** Team videos: files hosted here play inline, older links open in a new tab. */
export function VideoList({ videos, onRemove, removing }: Props) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((v) => (
        <div
          key={v.id}
          className="overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary/60"
        >
          {v.hosted && v.url ? (
            <video
              src={v.url}
              controls
              preload="metadata"
              poster={v.thumbnail_url ?? undefined}
              className="aspect-video w-full bg-secondary object-cover"
            />
          ) : (
            <a href={v.media_url} target="_blank" rel="noreferrer" className="group block">
              <div className="relative aspect-video bg-secondary">
                {v.thumbnail_url ? (
                  <img
                    src={v.thumbnail_url}
                    alt={v.title}
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : null}
                <span className="absolute inset-0 flex items-center justify-center">
                  <Play className="size-10 text-primary opacity-80 transition-transform group-hover:scale-110" />
                </span>
              </div>
            </a>
          )}
          <div className="space-y-1 p-4">
            <p className="font-display text-base uppercase tracking-wide">{v.title}</p>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {v.hosted ? "On this site" : (SOURCE_LABEL[v.source] ?? v.source)}
            </p>
            {v.description ? (
              <p className="text-sm text-muted-foreground">{v.description}</p>
            ) : null}
            {onRemove ? (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 px-0 text-xs"
                disabled={removing}
                onClick={() => onRemove(v)}
              >
                <Trash2 className="mr-1 size-3" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
