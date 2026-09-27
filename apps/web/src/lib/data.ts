// Request-scoped, de-duplicated loaders: a layout and its page can both ask for the
// event without a second round trip to the API.
import { cache } from "react";
import { notFound } from "next/navigation";
import { api, ApiError } from "./api";
import type { EventDetail, MyTeam } from "./types";

export const getEvent = cache(async (slug: string): Promise<EventDetail> => {
  try {
    return await api<EventDetail>(`/api/events/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
});

export const getMyTeam = cache(async (slug: string): Promise<MyTeam | null> => {
  try {
    return await api<MyTeam>(`/api/events/${encodeURIComponent(slug)}/teams/mine`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
});
