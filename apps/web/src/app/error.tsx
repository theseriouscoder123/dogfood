"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg px-4 pt-24 text-center">
      <p className="font-display text-6xl font-extrabold text-primary">Oops</p>
      <h1 className="mt-3 text-2xl font-extrabold">Something went wrong</h1>
      <p className="mt-2 text-muted">Try again in a moment. If it keeps happening, let the organizers know.</p>
      <div className="mt-8 flex justify-center gap-3">
        <button type="button" onClick={reset} className={buttonClass("primary", "lg")}>
          Try again
        </button>
        <Link href="/" className={buttonClass("secondary", "lg")}>
          Home
        </Link>
      </div>
    </div>
  );
}
