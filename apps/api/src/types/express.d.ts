import type { Actor } from "../policy";

declare global {
  namespace Express {
    interface Request {
      actor: Actor | null;
      /** Set when the caller authenticated with a personal API token instead of a session. */
      apiToken: { id: string; name: string; scopes: string[] } | null;
      requestId: string;
    }
  }
}

export {};
