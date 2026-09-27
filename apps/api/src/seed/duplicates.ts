// Duplicate submissions in an imported file: same team and (same repository or same title).
// The earliest entry is canonical; later ones point at it. Pure, so the import and the
// normalization proof (which reads the fixture file directly) apply exactly the same rule.
export type FixtureProject = { id: string; team: string; title: string; repo_url?: string | null; submitted_at: string };

const normUrl = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/\.git$/, "");
const normTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/** Projects oldest first, each with the external id it duplicates (if any) and why. */
export function detectDuplicates<P extends FixtureProject>(projects: P[]): Array<{ project: P; duplicateOf: string | null; reason: string | null }> {
  const seen = new Map<string, string>();
  return [...projects]
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at) || a.id.localeCompare(b.id))
    .map((p) => {
      const keys: Array<[string, string]> = [[`${p.team}|title|${normTitle(p.title)}`, "same team and title"]];
      if (p.repo_url) keys.unshift([`${p.team}|repo|${normUrl(p.repo_url)}`, "same team and repository"]);
      const hit = keys.find(([k]) => seen.has(k));
      if (hit) return { project: p, duplicateOf: seen.get(hit[0])!, reason: hit[1] };
      for (const [k] of keys) seen.set(k, p.id);
      return { project: p, duplicateOf: null, reason: null };
    });
}
