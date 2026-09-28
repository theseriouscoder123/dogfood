import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { NotificationCentre } from "./NotificationCentre";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const me = await getMe();
  if (!me.user) redirect("/login?next=/notifications");
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <NotificationCentre />
    </div>
  );
}
