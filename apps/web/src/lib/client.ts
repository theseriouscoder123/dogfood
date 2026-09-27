// Browser-side calls to the API (same origin; the gateway or dev proxy forwards /api).
export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; details?: unknown };

export async function send<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return { ok: true, data: undefined as T };
  const json = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
  if (!res.ok) {
    return { ok: false, status: res.status, code: json?.error?.code ?? "error", message: readable(json?.error), details: json?.error?.details };
  }
  return { ok: true, data: json as T };
}

/** Turn validation errors into one readable line. */
function readable(error: { code?: string; message?: string; details?: unknown } | undefined): string {
  if (!error) return "Something went wrong.";
  if (error.code === "invalid_request" && Array.isArray(error.details)) {
    return error.details
      .map((d: { path?: unknown[]; message?: string }) => `${(d.path ?? []).join(".") || "input"}: ${d.message ?? "invalid"}`)
      .join("; ");
  }
  return error.message ?? "Something went wrong.";
}

/** <input type="datetime-local"> value (UTC) ⇄ ISO string. The UI shows and edits times in UTC. */
export const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
export const fromLocalInput = (v: string) => (v ? new Date(v + ":00Z").toISOString() : null);
