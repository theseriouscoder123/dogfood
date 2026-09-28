import { api } from "@/lib/api";
import { NotificationPrefs } from "./NotificationPrefs";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const data = await api<{ email: boolean; muted: string[]; categories: Record<string, string> }>("/api/me/notification-settings");
  return (
    <>
      <h1 className="text-3xl font-extrabold">Notifications</h1>
      <NotificationPrefs initial={data} />
    </>
  );
}
