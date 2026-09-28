import { SectionSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6">
      <SectionSkeleton />
    </div>
  );
}
