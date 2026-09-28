import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 pt-24 text-center">
      <p className="font-display text-7xl font-extrabold text-primary">404</p>
      <h1 className="mt-3 text-2xl font-extrabold">This page doesn&apos;t exist</h1>
      <p className="mt-2 text-muted">It may have been moved, or you may not have access to it.</p>
      <Link href="/" className={buttonClass("primary", "lg", "mt-8")}>
        Back to Dogfood
      </Link>
    </div>
  );
}
