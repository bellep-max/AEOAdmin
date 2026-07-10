/** One narrative paragraph. Renders a skeleton while the narrative fetch is
 *  in flight and nothing at all when the section came back empty (""). */
export function NarrativeBlock({
  text,
  isLoading,
}: {
  text: string | undefined;
  isLoading: boolean;
}) {
  const trimmed = text?.trim();
  if (!isLoading && !trimmed) return null;

  return (
    <div className="rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2">
      {isLoading && !trimmed ? (
        <div className="space-y-1.5 py-0.5">
          <div className="h-2.5 w-11/12 animate-pulse rounded bg-muted" />
          <div className="h-2.5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {trimmed}
        </p>
      )}
    </div>
  );
}
