import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Share2, X } from "lucide-react";
import { toast } from "sonner";

import { PhotoTagBar, type PhotoKind } from "@/components/PhotoTags";
import { Button } from "@/components/ui/button";

export type GalleryPhoto = {
  id: string;
  url: string | null;
  /** Full-size link for the viewer/download/share; falls back to url. */
  fullUrl?: string | null;
  alt: string;
  caption?: string | null;
  kind?: PhotoKind;
};

// Google-hosted thumbnails carry a size suffix (=w600-...); swap it for a
// full-size request. Other URLs (signed storage links) download as-is.
function fullSizeUrl(url: string) {
  if (/googleusercontent\.com/.test(url)) return url.replace(/=[a-z0-9-]*$/i, "=w2400");
  return url;
}

async function downloadPhoto(url: string, alt: string) {
  const name = `${alt.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "photo"}.jpg`;
  try {
    const res = await fetch(fullSizeUrl(url));
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
  } catch {
    window.open(fullSizeUrl(url), "_blank", "noreferrer");
  }
}

async function sharePhoto(url: string, alt: string) {
  const shareUrl = fullSizeUrl(url);

  if (navigator.share) {
    let shareData: ShareData = {
      title: "1836 - The DugOut",
      text: alt,
      url: shareUrl,
    };

    try {
      const response = await fetch(shareUrl);
      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], "1836-dugout-photo.jpg", {
          type: blob.type || "image/jpeg",
        });
        const fileShare: ShareData = { title: "1836 - The DugOut", text: alt, files: [file] };
        if (!navigator.canShare || navigator.canShare(fileShare)) shareData = fileShare;
      }
    } catch {
      // The photo link still works when its host does not allow a file download.
    }

    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }

  try {
    await navigator.clipboard.writeText(shareUrl);
    toast.success("Photo link copied");
  } catch {
    window.open(shareUrl, "_blank", "noreferrer");
  }
}



export function PhotoGrid({ photos, taggable = true }: { photos: GalleryPhoto[]; taggable?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shown = photos.filter((p) => p.url);
  // Big galleries paint far faster when the first screens load on their own and
  // the rest follow as the visitor scrolls.
  const PAGE = 48;
  const [limit, setLimit] = useState(PAGE);
  const visible = shown.slice(0, limit);

  const move = useCallback(
    (delta: number) => {
      setOpen((cur) => {
        if (cur === null) return cur;
        const next = cur + delta;
        if (next < 0 || next >= shown.length) return cur;
        return next;
      });
    },
    [shown.length],
  );

  useEffect(() => {
    if (open === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
      if (e.key === "ArrowRight") move(1);
      if (e.key === "ArrowLeft") move(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, move]);

  const active = open === null ? null : shown[open];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setOpen(i)}
            className="group overflow-hidden rounded-md border border-border bg-secondary transition-colors hover:border-primary/60"
          >
            <img
              src={p.url!}
              alt={p.alt}
              loading={i < 8 ? "eager" : "lazy"}
              decoding="async"
              width={640}
              height={640}
              className="aspect-square w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          </button>
        ))}
      </div>

      {limit < shown.length ? (
        <div className="mt-6 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLimit((l) => l + PAGE)}
            className="border-primary/60 text-xs uppercase tracking-widest text-primary"
          >
            Show more photos ({shown.length - limit} left)
          </Button>
        </div>
      ) : null}

      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/95 p-4"
          onClick={() => setOpen(null)}
        >
          <button
            type="button"
            aria-label="Close photo"
            onClick={() => setOpen(null)}
            className="absolute right-4 top-4 rounded-md border border-border p-2 text-foreground hover:bg-secondary"
          >
            <X className="size-5" />
          </button>
          <img
            src={(active.fullUrl ?? active.url)!}
            alt={active.alt}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[80vh] max-w-full rounded-lg object-contain"
          />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              aria-label="Previous photo"
              disabled={open === 0}
              onClick={() => move(-1)}
              className="rounded-md border border-border p-2 disabled:opacity-40 hover:bg-secondary"
            >
              <ChevronLeft className="size-5" />
            </button>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              {(open ?? 0) + 1} / {shown.length}
            </p>
            <button
              type="button"
              aria-label="Next photo"
              disabled={open === shown.length - 1}
              onClick={() => move(1)}
              className="rounded-md border border-border p-2 disabled:opacity-40 hover:bg-secondary"
            >
              <ChevronRight className="size-5" />
            </button>
            <Button
              type="button"
              variant="outline"
              aria-label="Share photo"
              disabled={sharing}
              onClick={() => {
                if (!active.url) return;
                setSharing(true);
                void sharePhoto(active.fullUrl ?? active.url, active.alt).finally(() => setSharing(false));
              }}
              className="h-auto border-primary/60 px-3 py-2 text-xs uppercase text-primary"
            >
              <Share2 className="size-4" />
              {sharing ? "Opening…" : "Share"}
            </Button>
            <button
              type="button"
              aria-label="Download full-size photo"
              disabled={downloading}
              onClick={() => {
                setDownloading(true);
                void downloadPhoto((active.fullUrl ?? active.url)!, active.alt).finally(() => setDownloading(false));
              }}
              className="flex items-center gap-1.5 rounded-md border border-primary/60 px-3 py-2 text-xs uppercase tracking-widest text-primary disabled:opacity-40 hover:bg-primary/10"
            >
              <Download className="size-4" />
              {downloading ? "Saving…" : "Download"}
            </button>
          </div>
          {active.caption ? (
            <p className="mt-3 max-w-xl text-center text-sm text-muted-foreground">
              {active.caption}
            </p>
          ) : null}
          {taggable ? (
            <div onClick={(e) => e.stopPropagation()}>
              <PhotoTagBar photoId={active.id} kind={active.kind ?? "album"} />
            </div>
          ) : null}

        </div>
      ) : null}
    </>
  );
}
