import Link from "next/link";
import { ChevronLeft, ChevronRight, Layers, Search } from "lucide-react";
import { api } from "@/lib/api";
import { EmptyState, inputClass } from "@/components/ui";
import { Cover } from "@/components/visuals";

export const metadata = { title: "Projects" };

type Result = {
  total: number;
  page: number;
  pageSize: number;
  projects: Array<{ id: string; title: string; tagline: string; thumbnailUrl: string | null; techTags: string[]; team: { name: string }; track: { name: string } | null; event: { slug: string; name: string } }>;
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q = "", page = "1" } = await searchParams;
  const params = new URLSearchParams({ ...(q ? { q } : {}), page });
  const r = await api<Result>(`/api/projects?${params}`);
  const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const href = (p: number) => `/projects?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold sm:text-4xl">Projects</h1>
          <p className="mt-1 text-sm text-muted">{r.total.toLocaleString()} submitted across every hackathon</p>
        </div>
        <form action="/projects" className="relative w-full sm:w-96">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 mt-[3px] size-4 -translate-y-1/2 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search by title, team, tech or hackathon" className={`${inputClass} pl-10`} />
        </form>
      </div>

      {r.projects.length === 0 ? (
        <EmptyState icon={<Layers className="size-5" />} title={q ? `Nothing matches “${q}”` : "No projects yet"} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {r.projects.map((p) => (
            <li key={p.id}>
              <Link href={`/events/${p.event.slug}/projects/${p.id}`} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
                <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} rounded="rounded-none" className="aspect-[16/10] w-full" />
                <div className="flex flex-1 flex-col p-4">
                  <h2 className="line-clamp-1 font-bold group-hover:text-primary">{p.title}</h2>
                  <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{p.tagline}</p>
                  {p.techTags.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {p.techTags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="mt-3 border-t border-line pt-3 text-xs text-muted">
                    <span className="font-semibold text-ink-2">{p.team.name}</span> · {p.event.name}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2 text-sm font-semibold" aria-label="Pages">
          {r.page > 1 && (
            <Link href={href(r.page - 1)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-2 hover:bg-surface-2">
              <ChevronLeft className="size-4" /> Previous
            </Link>
          )}
          <span className="px-3 text-muted">
            Page {r.page} of {pages}
          </span>
          {r.page < pages && (
            <Link href={href(r.page + 1)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-2 hover:bg-surface-2">
              Next <ChevronRight className="size-4" />
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
