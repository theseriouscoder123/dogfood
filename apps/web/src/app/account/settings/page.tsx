import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { api } from "@/lib/api";
import type { MyProfile } from "@/lib/types";
import { ProfileForm } from "./ProfileForm";

export const metadata = { title: "Profile settings" };

export default async function SettingsPage() {
  const { profile } = await api<{ profile: MyProfile }>("/api/me/profile");
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-3xl font-extrabold">Profile</h1>
        <Link href={`/u/${profile.handle}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          View public profile <ArrowUpRight className="size-4" />
        </Link>
      </div>
      <ProfileForm profile={profile} />
    </>
  );
}
