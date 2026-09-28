"use client";

// Toasts and dialogs, in place of the browser's alert/confirm/prompt.
//   const toast = useToast();      toast.success("Saved")
//   const ask = useDialog();       if (await ask.confirm({ title: "Delete?", danger: true })) …
//                                  const reason = await ask.prompt({ title: "Why?", minLength: 5 })
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { buttonClass, inputClass } from "./ui";

type Tone = "success" | "error" | "info";
type Toast = { id: number; tone: Tone; text: string };
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
type PromptOpts = ConfirmOpts & { label?: string; placeholder?: string; minLength?: number; multiline?: boolean; initial?: string };
type Pending = { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void } | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

const ToastCtx = createContext<{ show: (tone: Tone, text: string) => void } | null>(null);
const DialogCtx = createContext<{ open: (p: Pending) => void } | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);

  const show = useCallback((tone: Tone, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 3500);
  }, []);

  return (
    <ToastCtx.Provider value={{ show }}>
      <DialogCtx.Provider value={{ open: setPending }}>
        {children}
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
          {toasts.map((t) => {
            const Icon = t.tone === "success" ? CheckCircle2 : t.tone === "error" ? XCircle : Info;
            return (
              <div
                key={t.id}
                role="status"
                className="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 text-sm shadow-lift animate-[toast-in_.18s_ease-out]"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${t.tone === "success" ? "text-success" : t.tone === "error" ? "text-danger" : "text-primary"}`} />
                <span className="flex-1">{t.text}</span>
                <button type="button" aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                  <X className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
        {pending && <Dialog pending={pending} close={() => setPending(null)} />}
      </DialogCtx.Provider>
    </ToastCtx.Provider>
  );
}

function Dialog({ pending, close }: { pending: Pending; close: () => void }) {
  const o = pending.opts;
  const prompt = pending.kind === "prompt" ? (pending.opts as PromptOpts) : null;
  const [value, setValue] = useState(prompt?.initial ?? "");
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const tooShort = prompt ? value.trim().length < (prompt.minLength ?? 1) : false;

  const finish = (ok: boolean) => {
    if (pending.kind === "confirm") pending.resolve(ok);
    else pending.resolve(ok ? value.trim() : null);
    close();
  };

  useEffect(() => {
    (prompt ? input.current : confirmBtn.current)?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && finish(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-lift animate-[toast-in_.15s_ease-out]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooShort) finish(true);
        }}
      >
        <div className="flex gap-3">
          {o.danger && (
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 id="dlg-title" className="text-lg font-bold">
              {o.title}
            </h2>
            {o.body && <div className="mt-1 text-sm text-muted">{o.body}</div>}
          </div>
        </div>
        {prompt && (
          <label className="mt-4 block">
            {prompt.label && <span className="text-[13px] font-semibold">{prompt.label}</span>}
            {prompt.multiline ? (
              <textarea ref={input} rows={3} className={inputClass} value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <input ref={input} className={inputClass} value={value} placeholder={prompt.placeholder} onChange={(e) => setValue(e.target.value)} />
            )}
          </label>
        )}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className={buttonClass("ghost", "md")} onClick={() => finish(false)}>
            Cancel
          </button>
          <button ref={confirmBtn} type="submit" disabled={tooShort} className={buttonClass(o.danger ? "danger" : "primary", "md")}>
            {o.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast outside FeedbackProvider");
  return {
    success: (text: string) => ctx.show("success", text),
    error: (text: string) => ctx.show("error", text),
    info: (text: string) => ctx.show("info", text),
  };
}

export function useDialog() {
  const ctx = useContext(DialogCtx);
  if (!ctx) throw new Error("useDialog outside FeedbackProvider");
  return {
    confirm: (opts: ConfirmOpts) => new Promise<boolean>((resolve) => ctx.open({ kind: "confirm", opts, resolve })),
    prompt: (opts: PromptOpts) => new Promise<string | null>((resolve) => ctx.open({ kind: "prompt", opts, resolve })),
  };
}
