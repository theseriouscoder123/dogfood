import { Braces, Hash, MessageCircle } from "lucide-react";

export const FORMATS = [
  { key: "slack", label: "Slack", icon: Hash, hint: "Paste a Slack incoming-webhook URL (hooks.slack.com/…)", placeholder: "https://hooks.slack.com/services/…" },
  { key: "discord", label: "Discord", icon: MessageCircle, hint: "Server settings → Integrations → Webhooks → Copy URL", placeholder: "https://discord.com/api/webhooks/…" },
  { key: "standard", label: "Custom (JSON)", icon: Braces, hint: "Signed JSON for your own service", placeholder: "https://example.org/hooks/dogfood" },
] as const;
export type Format = (typeof FORMATS)[number]["key"];

const STYLE: Record<Format, string> = {
  slack: "bg-[#4a154b] text-white",
  discord: "bg-[#5865f2] text-white",
  standard: "bg-surface-2 text-ink-2",
};

export function FormatBadge({ format }: { format: Format }) {
  const f = FORMATS.find((x) => x.key === format) ?? FORMATS[2];
  return (
    <span title={f.label} className={`grid size-10 shrink-0 place-items-center rounded-xl ${STYLE[f.key]}`}>
      <f.icon className="size-5" />
    </span>
  );
}
