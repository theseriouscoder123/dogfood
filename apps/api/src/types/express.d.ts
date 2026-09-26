import type { Actor } from "../policy";

declare global {
  namespace Express {
    interface Request {
      actor: Actor | null;
      requestId: string;
    }
  }
}

export {};
