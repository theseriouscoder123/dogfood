// Server-side API client. Pages render on the server and call the API with the
// visitor's own cookie, so the API's permission checks apply to every page too.
import { cookies } from "next/headers";

const API_URL = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new ApiError(res.status, body?.error?.code ?? "error", body?.error?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}
