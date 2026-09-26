import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

/** Throw anywhere in a handler; the error middleware turns it into a JSON response. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message?: string,
    public readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export const unauthenticated = () => new HttpError(401, "unauthenticated", "Log in to do this.");
export const forbidden = (message = "You are not allowed to do this.") => new HttpError(403, "forbidden", message);
export const notFound = (what = "Resource") => new HttpError(404, "not_found", `${what} not found.`);

export const apiNotFound: RequestHandler = (req, _res, next) => next(notFound(`Route ${req.method} ${req.path}`));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: "invalid_request", message: "Request validation failed.", details: err.issues } });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: { code: "conflict", message: "That already exists.", details: err.meta } });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "invalid_json", message: "Body is not valid JSON." } });
    return;
  }
  console.error(`[${req.requestId}]`, err);
  res.status(500).json({ error: { code: "internal", message: "Something went wrong.", requestId: req.requestId } });
};
