// Slack and Discord formats: the same events, as one readable line for a channel. Paste an
// incoming-webhook URL from Slack or Discord and pick the matching format.
import { config } from "../config";

type Payload = { type: string; event?: { slug?: string; name?: string }; data?: Record<string, unknown> };

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** One line describing the event, with a link back to the portal. */
export function chatText(p: Payload): string {
  const ev = p.event?.name ?? "your hackathon";
  const base = `${config.publicBaseUrl}/events/${p.event?.slug ?? ""}`;
  const d = obj(p.data);
  const project = obj(d.project);
  const title = typeof project.title === "string" ? `“${project.title}”` : "A project";
  const projectUrl = typeof project.id === "string" ? `${base}/projects/${project.id}` : base;
  const team = obj(d.team);
  switch (p.type) {
    case "project.submitted":
      return `${title} was submitted to ${ev}. ${projectUrl}`;
    case "project.created":
      return `A new project, ${title}, was started in ${ev}.`;
    case "project.updated":
      return `${title} was updated in ${ev}.`;
    case "project.unsubmitted":
      return `${title} went back to draft in ${ev}.`;
    case "project.withdrawn":
      return `${title} was withdrawn from ${ev}.`;
    case "participant.registered":
      return `Someone new registered for ${ev}.`;
    case "team.created":
      return `Team ${team.name ?? ""} formed in ${ev}.`.replace("Team  formed", "A team formed");
    case "team.member_joined":
      return `Someone joined team ${team.name ?? ""} in ${ev}.`;
    case "team.member_left":
      return `Someone left a team in ${ev}.`;
    case "comment.created":
      return `New comment in ${ev}: ${base}/projects/${obj(d.comment).projectId ?? ""}`;
    case "comment.reported":
      return `A comment was reported in ${ev} (${d.reason ?? "no reason"}). Review it: ${base}/manage/comments`;
    case "judge.invited":
      return `A judge joined the panel for ${ev}.`;
    case "assignments.committed":
      return `${obj(d.batch).assignments ?? "New"} judging assignments went out for ${ev}.`;
    case "review.submitted":
      return `A review was submitted in ${ev}.`;
    case "results.published":
      return `Results are out for ${ev}! ${base}/results`;
    case "results.unpublished":
      return `Results for ${ev} were taken down.`;
    case "peoples_choice.published":
      return `People's Choice results are out for ${ev}! ${base}/peoples-choice`;
    case "peoples_choice.unpublished":
      return `People's Choice results for ${ev} were taken down.`;
    case "records.issued":
      return `${d.issued ?? 0} certificates were signed for ${ev}.`;
    case "event.updated":
      return `${ev} was updated (${Array.isArray(d.changed) ? d.changed.join(", ") : "details"}).`;
    case "webhook.ping":
      return `Dogfood is connected. Updates from ${ev} will appear here.`;
    default:
      return `${p.type} in ${ev}.`;
  }
}

export const FORMATS = ["standard", "slack", "discord"] as const;
export type WebhookFormat = (typeof FORMATS)[number];

/** The request body for a delivery, in the endpoint's format. */
export function bodyFor(format: string, payload: Payload, standardBody: string): string {
  if (format === "slack") return JSON.stringify({ text: chatText(payload) });
  if (format === "discord") return JSON.stringify({ content: chatText(payload), allowed_mentions: { parse: [] } });
  return standardBody;
}
