import { api } from "@/lib/api";
import type { MyProfile } from "@/lib/types";
import { SecurityForms } from "./SecurityForms";

export const metadata = { title: "Password & sessions" };

export default async function SecurityPage() {
  const [{ profile }, { sessions }] = await Promise.all([
    api<{ profile: MyProfile }>("/api/me/profile"),
    api<{ sessions: Array<{ current: boolean; createdAt: string; expiresAt: string }> }>("/api/me/sessions"),
  ]);
  return (
    <>
      <h1 className="text-3xl font-extrabold">Password &amp; sessions</h1>
      <SecurityForms email={profile.email} hasPassword={profile.hasPassword} sessions={sessions} />
    </>
  );
}
