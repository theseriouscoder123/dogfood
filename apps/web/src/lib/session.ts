import { api } from "./api";
import type { Me } from "./types";

export async function getMe(): Promise<Me> {
  return api<Me>("/api/auth/me").catch(() => ({ user: null, roles: [] }) as Me);
}
