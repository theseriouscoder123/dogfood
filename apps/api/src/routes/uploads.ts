// Image uploads (event banners and logos, project thumbnails), stored on local disk.
// Files are named by their sha256, so re-uploading the same image is free and URLs never change.
// The file type is taken from the bytes, not the client's header, and SVG is refused (it can carry script).
import express, { Router } from "express";
import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../db";
import { config } from "../config";
import { HttpError, notFound, unauthenticated } from "../lib/http";

export const uploadsRouter = Router();
export const filesRouter = Router();

const TYPES = [
  { mime: "image/png", ext: "png", magic: (b: Buffer) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", magic: (b: Buffer) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: "gif", magic: (b: Buffer) => b.subarray(0, 4).toString("ascii") === "GIF8" },
  { mime: "image/webp", ext: "webp", magic: (b: Buffer) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
] as const;

const MAX_PER_HOUR = 60;

/** A reference the app accepts wherever an image URL is stored: one of our files, or any http(s) URL. */
export const LOCAL_FILE = /^\/api\/files\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/;

uploadsRouter.post(
  "/",
  express.raw({ type: () => true, limit: config.uploadMaxBytes }),
  async (req, res) => {
    if (!req.actor) throw unauthenticated();
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "empty_upload", "Send the image bytes as the request body.");
    const type = TYPES.find((t) => t.magic(body));
    if (!type) throw new HttpError(415, "unsupported_type", "Only PNG, JPEG, GIF and WebP images are accepted.");

    const recent = await prisma.upload.count({ where: { uploadedById: req.actor.id, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
    if (recent >= MAX_PER_HOUR) throw new HttpError(429, "too_many_uploads", "Upload limit reached; try again in an hour.");

    const sha256 = createHash("sha256").update(body).digest("hex");
    const name = `${sha256}.${type.ext}`;
    await mkdir(config.uploadDir, { recursive: true });
    const file = path.join(config.uploadDir, name);
    const exists = await access(file).then(() => true, () => false);
    if (!exists) await writeFile(file, body, { mode: 0o644 });
    await prisma.upload.upsert({
      where: { sha256 },
      update: {},
      create: { sha256, mimeType: type.mime, sizeBytes: body.length, uploadedById: req.actor.id },
    });
    res.status(201).json({ url: `/api/files/${name}`, mimeType: type.mime, sizeBytes: body.length });
  },
);

filesRouter.get("/:name", async (req, res) => {
  const m = req.params.name.match(/^([a-f0-9]{64})\.(png|jpg|gif|webp)$/);
  if (!m) throw notFound("File");
  const type = TYPES.find((t) => t.ext === m[2])!;
  const file = path.join(config.uploadDir, req.params.name);
  if (!(await access(file).then(() => true, () => false))) throw notFound("File");
  res.setHeader("Content-Type", type.mime);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  res.sendFile(file);
});
