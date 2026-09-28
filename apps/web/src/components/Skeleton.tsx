// Loading placeholders shown by the route-level loading.tsx files while a page's data arrives.

export function Bone({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-surface-2 ${className}`} />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
      <Bone className="h-5 w-2/5" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Bone key={i} className={`h-3.5 ${i === lines - 1 ? "w-3/5" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}

/** A page heading and a grid of cards: the shape of most list pages. */
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6" aria-busy="true" aria-label="Loading">
      <Bone className="h-9 w-64" />
      <Bone className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** A stack of cards inside an existing layout (event hub, organizer console, settings). */
export function SectionSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Bone className="h-7 w-48" />
      {Array.from({ length: cards }, (_, i) => (
        <CardSkeleton key={i} lines={i === 0 ? 4 : 2} />
      ))}
    </div>
  );
}
