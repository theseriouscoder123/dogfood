"use client";

// Drag-and-drop (or click) image upload. Sends the raw bytes to /api/uploads and hands
// back the stored URL; the parent keeps it in a hidden input or state.
import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";

const MAX_BYTES = 5 * 1024 * 1024;

export function ImageUpload({ value, onChange, aspect = "aspect-[16/9]", label = "Upload image", hint = "PNG, JPG, GIF or WebP · up to 5 MB" }: {
  value: string | null;
  onChange: (url: string | null) => void;
  aspect?: string;
  label?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File) {
    setError(null);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return setError("Use a PNG, JPG, GIF or WebP image.");
    if (file.size > MAX_BYTES) return setError("That image is larger than 5 MB.");
    setBusy(true);
    const res = await fetch("/api/uploads", { method: "POST", headers: { "Content-Type": file.type }, body: file });
    setBusy(false);
    const body = (await res.json().catch(() => null)) as { url?: string; error?: { message?: string } } | null;
    if (!res.ok || !body?.url) return setError(body?.error?.message ?? "Upload failed.");
    onChange(body.url);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void upload(f);
        }}
        className={`group relative ${aspect} w-full overflow-hidden rounded-xl border-2 border-dashed transition ${
          drag ? "border-primary bg-primary-soft" : value ? "border-transparent" : "border-line-strong bg-surface-2 hover:border-primary/60"
        }`}
      >
        {value ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={value} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition group-hover:opacity-100">
              <button type="button" onClick={() => input.current?.click()} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-black">
                Replace
              </button>
              <button type="button" onClick={() => onChange(null)} className="rounded-lg bg-white/90 p-1.5 text-black" aria-label="Remove image">
                <X className="size-4" />
              </button>
            </div>
          </>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="flex size-full flex-col items-center justify-center gap-2 text-center">
            {busy ? <Loader2 className="size-6 animate-spin text-primary" /> : <ImagePlus className="size-7 text-muted transition group-hover:text-primary" />}
            <span className="text-sm font-semibold text-ink">{busy ? "Uploading…" : label}</span>
            <span className="text-xs text-muted">Drag and drop, or click · {hint}</span>
          </button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="mt-2 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
