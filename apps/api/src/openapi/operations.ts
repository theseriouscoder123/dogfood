// The catalogue behind /api/openapi.json: one entry per route. Request schemas are the same zod
// objects the handlers parse with, so the documented contract is the enforced one.
// tests/unit/openapi.test.ts fails if a mounted route is missing here, or listed here but not mounted.
import { z } from "zod";
import * as S from "./schemas";
import { CreateTokenBody } from "../routes/tokens";
import { ForgotBody, LinkBody, LinkVerifyBody, LoginBody, RegisterBody, ResetBody } from "../routes/auth";
import { AddOrganizerBody, CreateEvent, DuplicateEventBody, PrizeBody, QuestionBody, TrackBody, UpdateEventBody } from "../routes/eventAdmin";
import { CreateProjectBody, GalleryQuery, UpdateProjectBody } from "../routes/projects";
import { EmailInviteBody, InviteBody as TeamInviteBody, TeamNameBody } from "../routes/teams";
import { CreateCommentBody, CommentsSettingsBody, EditCommentBody, HideCommentBody, ModerationQuery, ReportCommentBody } from "../routes/comments";
import { ConflictBody, CriterionBody, InviteBody as JudgeInviteBody, JudgeTracksBody, UpdateCriterionBody } from "../routes/judgingAdmin";
import { AddAssignmentBody, CommitPlanBody, PlanParams, ReassignBody } from "../routes/assignments";
import { CompareBody, ReviewBody, RecuseBody } from "../routes/judgeConsole";
import { PairwiseSettingsBody } from "../routes/pairwise";
import { RedistributeBody, RemindBody } from "../routes/progress";
import { OptionsBody } from "../routes/results";
import { ResolveBody } from "../routes/integrity";
import { BallotBody, CreateInvitesBody, QuarantineBody, ReceiptBody, RedeemBody, ResolveIncidentBody, RestoreBody, RevokeInvitesBody, SettingsBody } from "../routes/voting";
import { EXPORT_FILES } from "../routes/exports";
import { CreateWebhookBody, DeliveriesQuery, UpdateWebhookBody } from "../routes/webhooks";
import { RevokeRecordBody } from "../routes/records";
import { AnnouncementBody, FinderBody } from "../routes/community";
import { ImportQuery } from "../routes/eventImport";
import { DiscoverQuery } from "../routes/discover";
import { MarkReadBody, NotificationSettingsBody, NotificationsQuery, PasswordBody, ProfileBody } from "../routes/me";
import { EventFile } from "../portability/format";

export type Method = "get" | "post" | "put" | "patch" | "delete";

/** Who may call an operation. The API enforces this; the list only describes it. */
export const ACCESS = {
  public: "Anyone. No sign-in needed (signing in may show more, e.g. your own drafts).",
  signed_in: "Any signed-in user.",
  participant: "A participant in the event: signed in, and registration still open.",
  team_member: "A member of the project's team (or an organizer, for reading).",
  judge: "A judge of the event, for their own assignments only.",
  organizer: "An organizer of the event, or a portal admin.",
  admin: "A portal admin.",
  voter: "An eligible voter under the event's voting mode (verified email, ballot code or account).",
} as const;
export type Access = keyof typeof ACCESS;

export const TAGS = [
  { name: "Meta", description: "Health and this specification." },
  { name: "Auth", description: "Accounts and browser sessions. Scripts should use an API token instead of a password." },
  { name: "API tokens", description: "Personal tokens for scripts and integrations. Managing them needs a browser session." },
  { name: "Events", description: "Hackathons: public listing and detail." },
  { name: "Event setup", description: "Organizer configuration: dates, tracks, prizes, questions, co-organizers." },
  { name: "Teams", description: "Team formation by invite link or email." },
  { name: "Projects", description: "Submissions and the public gallery. Drafts are editable until the deadline, which the API enforces." },
  { name: "Files", description: "Image uploads (banners, logos, thumbnails)." },
  { name: "Community", description: "Organizer announcements and the team finder." },
  { name: "Comments", description: "Public comments on submitted projects." },
  { name: "Judging setup", description: "Rubric, judges, conflicts of interest." },
  { name: "Assignments", description: "Deterministic judge-to-project assignment." },
  { name: "Judge console", description: "A judge's own queue and reviews. Judges never see other judges' scores." },
  { name: "Progress", description: "Live judging progress for organizers." },
  { name: "Results", description: "Normalized judging results: preview, immutable runs, publishing." },
  { name: "Integrity", description: "Review integrity checks and organizer decisions." },
  { name: "Voting", description: "Community (People's Choice) voting: ballots, settings, abuse review." },
  { name: "People's Choice", description: "Published vote results, the anonymous ballot file and receipt checks." },
  { name: "Moderation", description: "Comment moderation for organizers." },
  { name: "Exports", description: "CSV exports for every stage. Each download is audit-logged." },
  { name: "Records", description: "Ed25519-signed judge participation records and participant certificates, verifiable by anyone." },
  { name: "Webhooks", description: "Signed HTTP callbacks to your systems when things happen in an event. See the Webhooks section below for payloads and verification." },
] as const;
export type Tag = (typeof TAGS)[number]["name"];

export type Operation = {
  method: Method;
  /** Express-style path, e.g. /api/events/:slug/projects */
  path: string;
  tag: Tag;
  summary: string;
  description?: string;
  access: Access;
  body?: z.ZodType;
  query?: z.ZodObject;
  /** JSON response schema, checked against live responses in the integration tests. */
  response?: z.ZodType;
  /** Success status; 204 means no body. */
  status?: 200 | 201 | 204;
  /** Non-JSON success responses. */
  produces?: "text/csv" | "text/markdown" | "image/*";
  /** Refuses API tokens: people at a browser only. */
  browserOnly?: boolean;
  /** Request body sent as raw bytes rather than JSON. */
  rawBody?: string;
};

export const PARAMS: Record<string, string> = {
  slug: 'The event\'s URL name, e.g. "dogfood-2026".',
  projectId: "Project id (UUID).",
  commentId: "Comment id (UUID).",
  trackId: "Track id (UUID).",
  prizeId: "Prize id (UUID).",
  questionId: "Submission question id (UUID).",
  criterionId: "Rubric criterion id (UUID).",
  userId: "User id (UUID).",
  judgeId: "The judge's user id (UUID).",
  judgeRef: '"me", a judge\'s imported id (e.g. "jdg_24"), or their user id.',
  conflictId: "Conflict-of-interest id (UUID).",
  assignmentId: "Assignment id (UUID).",
  runId: "Normalization run id (UUID).",
  inviteId: "Team invite id (UUID).",
  tokenId: "API token id (UUID).",
  token: "The invite token from the join link.",
  name: "File name as returned by the upload, e.g. <sha256>.png",
  file: `One of: ${EXPORT_FILES.join(", ")}.`,
  webhookId: "Webhook id (UUID).",
  deliveryId: "Delivery id (UUID).",
  recordId: "Record id (UUID); also the public verification id.",
  announcementId: "Announcement id (UUID).",
  postId: "Team-finder post id (UUID).",
  ref: "A person's handle, or their user id.",
};

const E = "/api/events/:slug";

export const OPERATIONS: Operation[] = [
  // ── meta ──
  { method: "get", path: "/api/health", tag: "Meta", summary: "Health check", access: "public", response: S.Health },
  { method: "get", path: "/api/openapi.json", tag: "Meta", summary: "This OpenAPI 3.1 document", access: "public" },

  // ── auth ──
  { method: "post", path: "/api/auth/register", tag: "Auth", summary: "Create an account and start a session", description: "409 `email_taken` if the email already has an account. If it belongs to someone invited or imported who has no password yet, answers 202 `{ pending: true }` and emails them a one-time link to set one: registering never signs you in to an account you haven't proved is yours.", access: "public", body: RegisterBody, status: 201 },
  { method: "post", path: "/api/auth/login", tag: "Auth", summary: "Sign in with email and password; sets the session cookie", access: "public", body: LoginBody },
  { method: "post", path: "/api/auth/logout", tag: "Auth", summary: "End the current session", access: "public", status: 204 },
  { method: "get", path: "/api/auth/me", tag: "Auth", summary: "The caller and their roles in each event", description: "Returns `user: null` for visitors. Handy for checking which account an API token belongs to.", access: "public", response: S.Me },
  { method: "post", path: "/api/auth/forgot", tag: "Auth", summary: "Email a password-reset link", description: "Always answers the same way, so it can't be used to find out whether an account exists.", access: "public", body: ForgotBody },
  { method: "post", path: "/api/auth/reset", tag: "Auth", summary: "Set a new password with a reset link's token", access: "public", body: ResetBody },
  { method: "post", path: "/api/auth/link", tag: "Auth", summary: "Email a one-time sign-in link (used for email-verified voting)", description: "Rate-limited per network and per inbox. Throwaway addresses are refused when the link leads to a ballot.", access: "public", body: LinkBody },
  { method: "post", path: "/api/auth/link/verify", tag: "Auth", summary: "Redeem a sign-in link; verifies the email and starts a session", access: "public", body: LinkVerifyBody },

  // ── API tokens ──
  { method: "get", path: "/api/auth/tokens", tag: "API tokens", summary: "List your API tokens", access: "signed_in", browserOnly: true, response: S.TokenList },
  { method: "post", path: "/api/auth/tokens", tag: "API tokens", summary: "Create an API token", description: "The response carries the token once, in `secret`. Only its hash is stored.", access: "signed_in", browserOnly: true, body: CreateTokenBody, status: 201, response: S.TokenCreated },
  { method: "delete", path: "/api/auth/tokens/:tokenId", tag: "API tokens", summary: "Revoke an API token (immediate, permanent)", access: "signed_in", browserOnly: true, status: 204 },

  // ── you ──
  { method: "get", path: "/api/me/dashboard", tag: "Auth", summary: "Your dashboard: every event you're part of, with what matters for each of your roles", access: "signed_in" },
  { method: "get", path: "/api/me/profile", tag: "Auth", summary: "Your profile, as you can edit it", access: "signed_in" },
  { method: "patch", path: "/api/me/profile", tag: "Auth", summary: "Edit your profile: name, handle, headline, bio, avatar, links, skills", access: "signed_in", body: ProfileBody },
  { method: "post", path: "/api/me/password", tag: "Auth", summary: "Change (or set) your password; signs out your other sessions", access: "signed_in", browserOnly: true, body: PasswordBody },
  { method: "get", path: "/api/me/sessions", tag: "Auth", summary: "Your signed-in sessions", access: "signed_in", browserOnly: true },
  { method: "post", path: "/api/me/sessions/revoke-others", tag: "Auth", summary: "Sign out everywhere else", access: "signed_in", browserOnly: true },
  { method: "get", path: "/api/me/notifications", tag: "Auth", summary: "Your notifications, newest first (30 per page), with the unread count", access: "signed_in", query: NotificationsQuery },
  { method: "post", path: "/api/me/notifications/read", tag: "Auth", summary: "Mark notifications read (some, or all)", access: "signed_in", body: MarkReadBody },
  { method: "get", path: "/api/me/notification-settings", tag: "Auth", summary: "Your notification preferences and the categories you can mute", access: "signed_in" },
  { method: "put", path: "/api/me/notification-settings", tag: "Auth", summary: "Turn email on or off, and mute categories", access: "signed_in", body: NotificationSettingsBody },
  { method: "get", path: "/api/users/:ref", tag: "Auth", summary: "A public profile: bio, links, skills, hackathon history and certificates (never the email)", access: "public" },
  { method: "get", path: "/api/projects", tag: "Projects", summary: "Search submitted projects across every public event", access: "public", query: DiscoverQuery },

  // ── events ──
  { method: "get", path: "/api/events", tag: "Events", summary: "List events", access: "public", response: S.EventList },
  { method: "get", path: E, tag: "Events", summary: "Event detail: dates, windows, tracks, prizes, rubric, questions, your roles", access: "public", response: S.EventDetail },
  { method: "post", path: "/api/events", tag: "Event setup", summary: "Host a hackathon: creates a draft event with you as its organizer", description: "Open to any signed-in user unless the platform sets HOSTING=admins. The event stays invisible to others until published.", access: "signed_in", body: CreateEvent, status: 201 },
  { method: "patch", path: E, tag: "Event setup", summary: "Update an event's details and dates", description: "Date changes are checked together: registration ≤ submissions open < close ≤ judging.", access: "organizer", body: UpdateEventBody },
  { method: "post", path: `${E}/duplicate`, tag: "Event setup", summary: "Run it again: a new draft with the same setup and the schedule shifted", description: "Copies details, tracks, prizes, rubric, submission questions and organizers. No participants, projects, judges or votes.", access: "organizer", body: DuplicateEventBody, status: 201 },
  { method: "post", path: `${E}/publish`, tag: "Event setup", summary: "Publish a draft event: it becomes visible and open for registration", access: "organizer" },
  { method: "post", path: `${E}/unpublish`, tag: "Event setup", summary: "Back to draft (only while nobody has joined)", access: "organizer" },
  { method: "post", path: `${E}/register`, tag: "Teams", summary: "Register as a participant", access: "participant" },
  { method: "post", path: `${E}/tracks`, tag: "Event setup", summary: "Add a track", access: "organizer", body: TrackBody, status: 201 },
  { method: "patch", path: `${E}/tracks/:trackId`, tag: "Event setup", summary: "Edit a track", access: "organizer", body: TrackBody.partial() },
  { method: "delete", path: `${E}/tracks/:trackId`, tag: "Event setup", summary: "Delete a track with no projects", access: "organizer", status: 204 },
  { method: "post", path: `${E}/prizes`, tag: "Event setup", summary: "Add a prize", access: "organizer", body: PrizeBody, status: 201 },
  { method: "patch", path: `${E}/prizes/:prizeId`, tag: "Event setup", summary: "Edit a prize", access: "organizer", body: PrizeBody.partial() },
  { method: "delete", path: `${E}/prizes/:prizeId`, tag: "Event setup", summary: "Delete a prize", access: "organizer", status: 204 },
  { method: "get", path: `${E}/organizers`, tag: "Event setup", summary: "List co-organizers", access: "organizer" },
  { method: "post", path: `${E}/organizers`, tag: "Event setup", summary: "Add a co-organizer by email", access: "organizer", body: AddOrganizerBody, status: 201 },
  { method: "delete", path: `${E}/organizers/:userId`, tag: "Event setup", summary: "Remove a co-organizer (never the last one)", access: "organizer", status: 204 },
  { method: "post", path: `${E}/questions`, tag: "Event setup", summary: "Add a submission question", access: "organizer", body: QuestionBody, status: 201 },
  { method: "patch", path: `${E}/questions/:questionId`, tag: "Event setup", summary: "Edit a submission question", description: "Send any subset of the fields; the result is validated as a whole.", access: "organizer", body: z.object(QuestionBody.shape).partial() },
  { method: "delete", path: `${E}/questions/:questionId`, tag: "Event setup", summary: "Delete a submission question", access: "organizer", status: 204 },

  // ── teams ──
  { method: "get", path: `${E}/teams/mine`, tag: "Teams", summary: "Your team in this event, with members, invites and projects", access: "signed_in" },
  { method: "post", path: `${E}/teams`, tag: "Teams", summary: "Create a team (registers you if needed)", access: "participant", body: TeamNameBody, status: 201 },
  { method: "patch", path: `${E}/teams/mine`, tag: "Teams", summary: "Rename your team", access: "participant", body: TeamNameBody },
  { method: "post", path: `${E}/teams/mine/invites`, tag: "Teams", summary: "Create an invite link", access: "participant", body: TeamInviteBody, status: 201 },
  { method: "post", path: `${E}/teams/mine/invites/email`, tag: "Teams", summary: "Email an invite link to someone", access: "participant", body: EmailInviteBody, status: 201 },
  { method: "delete", path: `${E}/teams/mine/invites/:inviteId`, tag: "Teams", summary: "Revoke an invite link", access: "participant", status: 204 },
  { method: "post", path: `${E}/teams/mine/leave`, tag: "Teams", summary: "Leave your team", access: "participant", status: 204 },
  { method: "delete", path: `${E}/teams/mine/members/:userId`, tag: "Teams", summary: "Remove a member (team captain only)", access: "participant", status: 204 },
  { method: "get", path: "/api/invites/:token", tag: "Teams", summary: "Preview an invite link: which team and event, and whether it still works", access: "public" },
  { method: "post", path: "/api/invites/:token/accept", tag: "Teams", summary: "Join the team behind an invite link", access: "participant", status: 201 },

  // ── projects ──
  { method: "get", path: `${E}/projects`, tag: "Projects", summary: "Public gallery: submitted projects, with search and track filter", description: "`q` matches title, tagline, team name and tech tags. `track` takes a track id or its imported external id.", access: "public", query: GalleryQuery, response: S.Gallery },
  { method: "post", path: `${E}/projects`, tag: "Projects", summary: "Start your team's project (as a draft)", access: "participant", body: CreateProjectBody, status: 201 },
  { method: "get", path: `${E}/projects/:projectId`, tag: "Projects", summary: "Project detail", description: "Drafts and withdrawn projects are visible to their team and organizers only; for anyone else they are a 404, so ids can't be probed.", access: "public", response: S.ProjectDetail },
  { method: "patch", path: `${E}/projects/:projectId`, tag: "Projects", summary: "Edit a project until the submission deadline", access: "team_member", body: UpdateProjectBody },
  { method: "post", path: `${E}/projects/:projectId/submit`, tag: "Projects", summary: "Submit (required fields are checked)", access: "team_member" },
  { method: "post", path: `${E}/projects/:projectId/unsubmit`, tag: "Projects", summary: "Back to draft, before the deadline", access: "team_member" },
  { method: "post", path: `${E}/projects/:projectId/withdraw`, tag: "Projects", summary: "Withdraw the project", access: "team_member" },

  // ── files ──
  { method: "post", path: "/api/uploads", tag: "Files", summary: "Upload an image (PNG, JPEG, GIF or WebP; the type is read from the bytes)", description: "Send the raw image as the request body. Returns a URL to store in bannerUrl, logoUrl or thumbnailUrl.", access: "signed_in", rawBody: "application/octet-stream", status: 201, response: S.Upload },
  { method: "get", path: "/api/files/:name", tag: "Files", summary: "Download an uploaded image", access: "public", produces: "image/*" },

  // ── comments ──
  { method: "get", path: `${E}/projects/:projectId/comments`, tag: "Comments", summary: "A project's comments, with one level of replies", access: "public" },
  { method: "post", path: `${E}/projects/:projectId/comments`, tag: "Comments", summary: "Post a comment or a reply", description: "Plain text. Links are refused from accounts less than a day old; duplicate and burst posting is limited.", access: "signed_in", browserOnly: true, body: CreateCommentBody, status: 201 },
  { method: "patch", path: `${E}/projects/:projectId/comments/:commentId`, tag: "Comments", summary: "Edit your comment within 15 minutes (the earlier text is audit-logged)", access: "signed_in", browserOnly: true, body: EditCommentBody },
  { method: "delete", path: `${E}/projects/:projectId/comments/:commentId`, tag: "Comments", summary: "Delete your comment", access: "signed_in", status: 204 },
  { method: "post", path: `${E}/projects/:projectId/comments/:commentId/report`, tag: "Comments", summary: "Report a comment", description: "Three reports from established accounts hide it until an organizer reviews it.", access: "signed_in", browserOnly: true, body: ReportCommentBody, status: 201 },

  // ── moderation ──
  { method: "get", path: `${E}/comments/moderation`, tag: "Moderation", summary: "Moderation queue", access: "organizer", query: ModerationQuery },
  { method: "put", path: `${E}/comments/settings`, tag: "Moderation", summary: "Set comments to open, read-only or off", access: "organizer", body: CommentsSettingsBody },
  { method: "post", path: `${E}/comments/:commentId/hide`, tag: "Moderation", summary: "Hide a comment, with a reason", access: "organizer", body: HideCommentBody },
  { method: "post", path: `${E}/comments/:commentId/unhide`, tag: "Moderation", summary: "Restore a hidden comment", access: "organizer" },
  { method: "post", path: `${E}/comments/:commentId/dismiss`, tag: "Moderation", summary: "Dismiss the reports on a comment", access: "organizer" },

  // ── judging setup ──
  { method: "get", path: `${E}/rubric`, tag: "Judging setup", summary: "The rubric with weights, and whether it is locked by existing scores", access: "organizer" },
  { method: "post", path: `${E}/criteria`, tag: "Judging setup", summary: "Add a rubric criterion", access: "organizer", body: CriterionBody, status: 201 },
  { method: "patch", path: `${E}/criteria/:criterionId`, tag: "Judging setup", summary: "Edit a criterion (the scale locks once scores exist; weights never do)", access: "organizer", body: UpdateCriterionBody },
  { method: "delete", path: `${E}/criteria/:criterionId`, tag: "Judging setup", summary: "Delete a criterion (before any scores exist)", access: "organizer", status: 204 },
  { method: "get", path: `${E}/judges`, tag: "Judging setup", summary: "Judges with their tracks and workload", access: "organizer" },
  { method: "post", path: `${E}/judges`, tag: "Judging setup", summary: "Invite a judge by email", access: "organizer", body: JudgeInviteBody, status: 201 },
  { method: "patch", path: `${E}/judges/:userId`, tag: "Judging setup", summary: "Set the tracks a judge covers", access: "organizer", body: JudgeTracksBody },
  { method: "delete", path: `${E}/judges/:userId`, tag: "Judging setup", summary: "Remove a judge with no submitted reviews", access: "organizer", status: 204 },
  { method: "get", path: `${E}/teams`, tag: "Judging setup", summary: "Teams with members and projects (for conflict pickers)", access: "organizer" },
  { method: "get", path: `${E}/conflicts`, tag: "Judging setup", summary: "Conflicts of interest", access: "organizer" },
  { method: "post", path: `${E}/conflicts`, tag: "Judging setup", summary: "Declare a conflict of interest between a judge and a team", access: "organizer", body: ConflictBody, status: 201 },
  { method: "delete", path: `${E}/conflicts/:conflictId`, tag: "Judging setup", summary: "Remove a conflict of interest", access: "organizer", status: 204 },

  // ── assignments ──
  { method: "post", path: `${E}/assignments/preview`, tag: "Assignments", summary: "Preview an assignment plan (nothing is saved)", description: "Deterministic for a given seed and input; the response carries both so the same plan can be committed.", access: "organizer", body: PlanParams },
  { method: "post", path: `${E}/assignments/commit`, tag: "Assignments", summary: "Commit a previewed plan", description: "Refused with 409 if anything changed since the preview (inputHash mismatch).", access: "organizer", body: CommitPlanBody },
  { method: "get", path: `${E}/assignments`, tag: "Assignments", summary: "All assignments", access: "organizer" },
  { method: "get", path: `${E}/assignments/eligible`, tag: "Assignments", summary: "Judges eligible for one project, with the reason others aren't", access: "organizer", query: z.object({ projectId: z.uuid() }) },
  { method: "post", path: `${E}/assignments`, tag: "Assignments", summary: "Assign one judge to one project by hand", access: "organizer", body: AddAssignmentBody, status: 201 },
  { method: "delete", path: `${E}/assignments/:assignmentId`, tag: "Assignments", summary: "Remove an assignment that has no submitted review", access: "organizer", status: 204 },
  { method: "post", path: `${E}/assignments/:assignmentId/reassign`, tag: "Assignments", summary: "Move an assignment to another judge", access: "organizer", body: ReassignBody, status: 201 },
  { method: "get", path: `${E}/assignment-batches`, tag: "Assignments", summary: "History of committed plans", access: "organizer" },

  // ── judge console ──
  { method: "get", path: `${E}/judging`, tag: "Judge console", summary: "Your assignments and their status", access: "judge" },
  { method: "get", path: `${E}/judging/:assignmentId`, tag: "Judge console", summary: "One assignment: the project, the rubric and your saved review", access: "judge" },
  { method: "put", path: `${E}/judging/:assignmentId/review`, tag: "Judge console", summary: "Save your review as a draft", access: "judge", body: ReviewBody },
  { method: "post", path: `${E}/judging/:assignmentId/submit`, tag: "Judge console", summary: "Submit your review (every criterion scored)", access: "judge" },
  { method: "get", path: `${E}/judging/pairwise`, tag: "Judge console", summary: "The next pair of your own projects to compare head to head", description: "Chosen from your own rubric scores and how often each project has been compared, never from other judges' verdicts. `pair` is null when you've compared every pair or head-to-head judging is off.", access: "judge" },
  { method: "post", path: `${E}/judging/pairwise`, tag: "Judge console", summary: "Say which of two of your projects is better", description: "Both must be your own live assignments; each pair once. 409 `pairwise_off` when the organizer hasn't turned it on.", access: "judge", body: CompareBody, status: 201 },
  { method: "post", path: `${E}/judging/:assignmentId/recuse`, tag: "Judge console", summary: "Recuse yourself, optionally declaring a conflict", access: "judge", body: RecuseBody },
  { method: "get", path: `${E}/judges/:judgeRef/scores`, tag: "Judge console", summary: "A judge's scores: your own, or any judge's for organizers", description: "Peer isolation: a judge asking for anyone but themselves gets 403, whether or not that judge exists.", access: "judge" },

  // ── progress ──
  { method: "get", path: `${E}/progress`, tag: "Progress", summary: "Live progress: per judge, per project, over time, with stragglers flagged", access: "organizer" },
  { method: "post", path: `${E}/progress/remind`, tag: "Progress", summary: "Email reminders to judges (6-hour cooldown each)", access: "organizer", body: RemindBody },
  { method: "post", path: `${E}/judges/:judgeId/redistribute`, tag: "Progress", summary: "Move a judge's unfinished work to other judges", access: "organizer", body: RedistributeBody, status: 201 },

  // ── results ──
  { method: "get", path: `${E}/normalization`, tag: "Results", summary: "Normalization state: inputs, saved runs, what is published", access: "organizer" },
  { method: "post", path: `${E}/normalization/preview`, tag: "Results", summary: "Compute normalized results without saving", access: "organizer", body: OptionsBody },
  { method: "post", path: `${E}/normalization/runs`, tag: "Results", summary: "Save an immutable results run", access: "organizer", body: OptionsBody, status: 201 },
  { method: "get", path: `${E}/normalization/runs/:runId`, tag: "Results", summary: "A saved run with every project and judge statistic", access: "organizer" },
  { method: "post", path: `${E}/normalization/runs/:runId/publish`, tag: "Results", summary: "Publish a run", description: "Only after judging closes, and only if the run's inputs still match the data (not stale).", access: "organizer" },
  { method: "post", path: `${E}/normalization/unpublish`, tag: "Results", summary: "Take results down", access: "organizer" },
  { method: "get", path: `${E}/normalization/report.md`, tag: "Results", summary: "This event's normalization report (method, evidence, judge effects)", access: "organizer", produces: "text/markdown" },
  { method: "put", path: `${E}/pairwise/settings`, tag: "Results", summary: "Turn head-to-head judging on or off", access: "organizer", body: PairwiseSettingsBody },
  { method: "get", path: `${E}/pairwise`, tag: "Results", summary: "Head-to-head ranking (Bradley–Terry) and its agreement with the rubric results", description: "Ratings on the Elo scale with standard errors and 90% rank ranges; projects the two methods place far apart; position bias; each judge's agreement with the rest of the panel (leave-one-out).", access: "organizer" },
  { method: "get", path: `${E}/results`, tag: "Results", summary: "Published results", description: "404 `results_not_published` until an organizer publishes a run.", access: "public", response: S.PublishedResults },

  // ── integrity ──
  { method: "get", path: `${E}/integrity`, tag: "Integrity", summary: "Integrity flags on reviews, inter-rater reliability and organizer decisions", access: "organizer" },
  { method: "post", path: `${E}/integrity/resolve`, tag: "Integrity", summary: "Record a decision on a flag", access: "organizer", body: ResolveBody },

  // ── voting ──
  { method: "get", path: `${E}/vote`, tag: "Voting", summary: "Your ballot: status, your picks and receipt, projects in your own random order", description: "Vote counts are never included while voting is open.", access: "public" },
  { method: "post", path: `${E}/vote/redeem`, tag: "Voting", summary: "Redeem a single-use ballot code (invite mode)", access: "public", browserOnly: true, body: RedeemBody, status: 201 },
  { method: "put", path: `${E}/ballot`, tag: "Voting", summary: "Save your ballot (change it freely until voting closes)", access: "voter", browserOnly: true, body: BallotBody },
  { method: "get", path: `${E}/voting/admin`, tag: "Voting", summary: "Voting settings and turnout (counts stay sealed while voting is open)", access: "organizer" },
  { method: "put", path: `${E}/voting/settings`, tag: "Voting", summary: "Configure voting: window, mode, votes per voter, allowed domains", access: "organizer", body: SettingsBody },
  { method: "post", path: `${E}/voting/invites`, tag: "Voting", summary: "Generate a batch of ballot codes (returned once)", access: "organizer", body: CreateInvitesBody },
  { method: "post", path: `${E}/voting/invites/revoke`, tag: "Voting", summary: "Revoke a batch of unused ballot codes", access: "organizer", body: RevokeInvitesBody },
  { method: "get", path: `${E}/voting/review`, tag: "Voting", summary: "Abuse review queue: incidents built from six detection signals", access: "organizer" },
  { method: "post", path: `${E}/voting/review/quarantine`, tag: "Voting", summary: "Set ballots aside (not counted), with a reason", access: "organizer", body: QuarantineBody },
  { method: "post", path: `${E}/voting/review/restore`, tag: "Voting", summary: "Count quarantined ballots again, with a reason", access: "organizer", body: RestoreBody },
  { method: "post", path: `${E}/voting/review/resolve`, tag: "Voting", summary: "Dismiss or reopen an incident", access: "organizer", body: ResolveIncidentBody },
  { method: "get", path: `${E}/voting/results/preview`, tag: "Voting", summary: "Tally preview after voting closes", access: "organizer" },
  { method: "post", path: `${E}/voting/results/publish`, tag: "Voting", summary: "Publish People's Choice results and fix the ballot file's SHA-256", access: "organizer" },
  { method: "post", path: `${E}/voting/results/unpublish`, tag: "Voting", summary: "Take People's Choice results down", access: "organizer" },

  // ── People's Choice ──
  { method: "get", path: `${E}/voting/results`, tag: "People's Choice", summary: "Published People's Choice results with the position-bias check", access: "public", response: S.VotingResults },
  { method: "get", path: `${E}/voting/ballots.json`, tag: "People's Choice", summary: "Every ballot, anonymous, for an independent recount", description: "Each ballot is keyed by sha256 of its receipt. The `X-Content-SHA256` header matches the hash fixed at publish time.", access: "public" },
  { method: "post", path: `${E}/voting/receipt`, tag: "People's Choice", summary: "Check that a receipt's ballot was counted as cast", description: "The receipt goes in the body, not the URL, so it stays out of logs.", access: "public", body: ReceiptBody },

  // ── exports ──
  { method: "get", path: `${E}/export`, tag: "Exports", summary: "Available exports with row counts", access: "organizer" },
  { method: "get", path: `${E}/export/event.json`, tag: "Exports", summary: "The whole event as one dogfood-event/v1 file (import it with POST /api/events/import)", description: "Everything needed to run the event elsewhere: settings, tracks, prizes, rubric, questions, people, teams, projects and answers, judges, conflicts, assignments and reviews. Not included: passwords, ballots, comments, results runs, the audit log, signed records, webhooks and API tokens.", access: "organizer" },
  { method: "post", path: "/api/events/import", tag: "Event setup", summary: "Create an event from a dogfood-event/v1 file or a DOGFOOD fixtures.json file", description: "Send the file itself as the JSON body (up to 25 MB). Every reference is checked first and all problems come back together (422 `import_invalid`, listed in `details`). With `dryRun=true` the import runs and is rolled back, so the counts are exactly what a real import would create. People are matched by email; new accounts have no password until claimed.", access: "admin", body: EventFile, query: ImportQuery, status: 201 },
  { method: "get", path: `${E}/export/:file`, tag: "Exports", summary: "Download one CSV (UTF-8 with BOM, formula-injection safe)", access: "organizer", produces: "text/csv" },

  // ── webhooks ──
  { method: "get", path: `${E}/webhooks`, tag: "Webhooks", summary: "Endpoints with 24-hour delivery counts, and the event types you can subscribe to", access: "organizer" },
  { method: "post", path: `${E}/webhooks`, tag: "Webhooks", summary: "Add an endpoint", description: "The response carries the signing secret once, in `secret`.", access: "organizer", body: CreateWebhookBody, status: 201 },
  { method: "get", path: `${E}/webhooks/:webhookId`, tag: "Webhooks", summary: "One endpoint and its latest 100 deliveries", access: "organizer", query: DeliveriesQuery },
  { method: "patch", path: `${E}/webhooks/:webhookId`, tag: "Webhooks", summary: "Change the URL, description or event types, or switch the endpoint off and on", access: "organizer", body: UpdateWebhookBody },
  { method: "delete", path: `${E}/webhooks/:webhookId`, tag: "Webhooks", summary: "Delete an endpoint and its delivery log", access: "organizer", status: 204 },
  { method: "post", path: `${E}/webhooks/:webhookId/rotate-secret`, tag: "Webhooks", summary: "Rotate the signing secret (the old one keeps signing for 24 hours)", access: "organizer" },
  { method: "post", path: `${E}/webhooks/:webhookId/ping`, tag: "Webhooks", summary: "Send a test delivery (type webhook.ping)", access: "organizer", status: 201 },
  { method: "get", path: `${E}/webhooks/:webhookId/deliveries/:deliveryId`, tag: "Webhooks", summary: "One delivery: the exact payload and every attempt with its response", access: "organizer" },
  // ── community ──
  { method: "get", path: `${E}/announcements`, tag: "Community", summary: "The event's announcements, pinned first", access: "public" },
  { method: "post", path: `${E}/announcements`, tag: "Community", summary: "Post an announcement (optionally notifying participants and judges)", access: "organizer", body: AnnouncementBody, status: 201 },
  { method: "patch", path: `${E}/announcements/:announcementId`, tag: "Community", summary: "Edit or pin an announcement", access: "organizer", body: AnnouncementBody.omit({ notify: true }).partial() },
  { method: "delete", path: `${E}/announcements/:announcementId`, tag: "Community", summary: "Delete an announcement", access: "organizer", status: 204 },
  { method: "get", path: `${E}/team-finder`, tag: "Community", summary: "Open team-finder posts: people looking for a team, and teams with room", access: "public" },
  { method: "put", path: `${E}/team-finder`, tag: "Community", summary: "Create or update your team-finder post", access: "participant", body: FinderBody },
  { method: "delete", path: `${E}/team-finder`, tag: "Community", summary: "Remove your team-finder post", access: "signed_in", status: 204 },
  { method: "post", path: `${E}/team-finder/:postId/invite`, tag: "Community", summary: "Invite someone who's looking to join your team (they get a single-use link)", access: "participant", status: 201 },

  // ── records ──
  { method: "get", path: `${E}/records`, tag: "Records", summary: "Issued records and certificates, and whether issuing is possible yet", access: "organizer" },
  { method: "post", path: `${E}/records/issue`, tag: "Records", summary: "Issue (or re-issue) signed records for every judge and participant", description: "Only after judging closes. Re-running re-signs only people whose facts changed; their previous record is marked superseded.", access: "organizer", status: 201 },
  { method: "post", path: `${E}/records/:recordId/revoke`, tag: "Records", summary: "Revoke a record, with a reason (permanent)", access: "organizer", body: RevokeRecordBody },
  { method: "get", path: "/api/records/keys", tag: "Records", summary: "Public keys that sign records, current and retired", access: "public" },
  { method: "get", path: "/api/records/mine", tag: "Records", summary: "Your own current records, across events", access: "signed_in" },
  { method: "get", path: "/api/records/:recordId", tag: "Records", summary: "Verify a record: its status, statement, the exact signed text and signature", description: "`signedText` is the exact UTF-8 text that was signed, so you can check the signature yourself rather than trust `signatureValid`.", access: "public" },
  { method: "get", path: "/api/records/:recordId/signed.json", tag: "Records", summary: "Download the portable signed record, for offline verification", access: "public" },
  { method: "post", path: `${E}/webhooks/:webhookId/deliveries/:deliveryId/redeliver`, tag: "Webhooks", summary: "Send a finished delivery again (same message id)", access: "organizer", status: 201 },
];
