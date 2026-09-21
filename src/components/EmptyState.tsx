import type { ReactNode } from "react";

export function EmptyState({
  title,
  copy,
  action,
}: {
  title: string;
  copy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 p-10 text-center">
      <h3 className="font-display text-lg uppercase tracking-wide text-foreground">{title}</h3>
      {copy ? <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">{copy}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}
