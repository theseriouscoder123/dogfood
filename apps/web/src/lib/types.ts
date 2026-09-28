// Response shapes of the API endpoints the web app uses.
export type Role = "participant" | "judge" | "organizer";
export type SubmissionWindow = "not_open" | "open" | "closed";

export type Me = {
  user: { id: string; email: string; name: string; isAdmin: boolean; handle: string; avatarUrl: string | null } | null;
  roles: Array<{ role: Role; event: { slug: string; name: string } }>;
};

export type EventSummary = {
  slug: string;
  name: string;
  description: string;
  tagline: string;
  location: string;
  bannerUrl: string | null;
  logoUrl: string | null;
  registrationOpensAt: string | null;
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  judgingOpensAt: string | null;
  judgingClosesAt: string | null;
  submissionWindow: SubmissionWindow;
  registrationWindow: SubmissionWindow;
  projectCount: number;
  participantCount: number;
  tracks: string[];
  prizeCount: number;
  prizeTotal: string | null;
};

export type Track = { id: string; externalId: string | null; name: string; description: string; projectCount?: number };

export type QuestionType = "short_text" | "long_text" | "url" | "single_select" | "checkbox";
export type Question = { id: string; label: string; help: string; type: QuestionType; options: string[]; required: boolean; isPublic: boolean; position: number };

export type EventDetail = {
  event: {
    slug: string;
    name: string;
    description: string;
    tagline: string;
    location: string;
    overview: string;
    rules: string;
    bannerUrl: string | null;
    logoUrl: string | null;
    timezone: string;
    registrationOpensAt: string | null;
    submissionsOpenAt: string;
    submissionsCloseAt: string;
    judgingOpensAt: string | null;
    judgingClosesAt: string | null;
    maxTeamSize: number;
    submissionWindow: SubmissionWindow;
    registrationWindow: SubmissionWindow;
    resultsPublished: boolean;
    publishedAt: string | null;
    votingOpensAt: string | null;
    votingClosesAt: string | null;
    votingWindow: VotingWindow;
    votingMode: VotingMode;
    votesPerVoter: number;
    votingPublished: boolean;
  };
  stats: { participants: number; teams: number; projects: number; prizeTotal: string | null };
  tracks: Track[];
  questions: Question[];
  prizes: Array<{ id: string; trackId: string | null; name: string; description: string; value: string; rank: number | null }>;
  criteria: Array<{ key: string; label: string; description: string; weight: number; minScore: number; maxScore: number }>;
  myRoles: Role[];
};

export type GalleryProject = {
  id: string;
  externalId: string | null;
  title: string;
  tagline: string;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  techTags: string[];
  submittedAt: string | null;
  track: { id: string; externalId: string | null; name: string } | null;
  team: { id: string; name: string };
};

export type Gallery = { event: { slug: string; name: string }; total: number; projects: GalleryProject[] };

export type Prize = EventDetail["prizes"][number];

export type MyTeam =
  | { registered: boolean; team: null }
  | {
      registered: true;
      myRole: "captain" | "member";
      maxTeamSize: number;
      team: {
        id: string;
        name: string;
        members: Array<{ id: string; name: string; email: string; role: "captain" | "member"; joinedAt: string }>;
        invites: Array<{ id: string; expiresAt: string; uses: number; maxUses: number; createdAt: string }>;
        projects: Array<{ id: string; title: string; status: ProjectStatus; submittedAt: string | null; updatedAt: string }>;
      };
    };

export type ProjectStatus = "draft" | "submitted" | "withdrawn" | "disqualified";

export type ProjectDetail = {
  project: {
    id: string;
    externalId: string | null;
    title: string;
    tagline: string;
    description: string;
    repoUrl: string | null;
    demoUrl: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    techTags: string[];
    status: ProjectStatus;
    submittedAt: string | null;
    updatedAt: string;
    track: { id: string; name: string } | null;
    team: { id: string; name: string; members: Array<{ name: string; role: string; profile: string; avatarUrl: string | null }> };
    duplicateOf?: string | null;
  };
  answers: Array<{ questionId: string; label: string; type: QuestionType; isPublic: boolean; value: string }>;
  canEdit: boolean;
  submissionWindow: SubmissionWindow;
};

export type InvitePreview = {
  status: "valid" | "expired" | "revoked" | "used_up" | "team_full" | "registration_closed" | "registration_not_open";
  team: { name: string; memberCount: number };
  event: { slug: string; name: string; maxTeamSize: number };
};

export type Criterion = { id: string; key: string; label: string; description: string; weight: number; minScore: number; maxScore: number; position: number };
export type Rubric = { criteria: Criterion[]; locked: boolean; scoreCount: number };

export type JudgeRow = {
  id: string;
  name: string;
  email: string;
  externalId: string | null;
  invitedAt: string;
  hasAccount: boolean;
  trackIds: string[];
  assigned: number;
  submitted: number;
  recused: number;
  conflicts: number;
};

export type ConflictRow = { id: string; source: "declared" | "detected"; note: string; createdAt: string; judge: { id: string; name: string }; team: { id: string; name: string } };
export type TeamRow = { id: string; name: string; externalId: string | null; members: Array<{ name: string; email: string }>; projects: Array<{ id: string; title: string; status: string }> };

export type AssignmentStatus = "assigned" | "in_progress" | "submitted" | "recused";
export type LoadStats = { min: number; max: number; mean: number; stdev: number };
export type AssignPreview = {
  params: { reviewsPerProject: number; maxPerJudge: number | null; seed: number; mode: "fill" | "simulate" };
  inputHash: string;
  canCommit: boolean;
  summary: {
    projects: number;
    judges: number;
    existing: number;
    newAssignments: number;
    shortfalls: number;
    components: number;
    coverage: Record<string, number>;
    loadBefore: LoadStats;
    loadAfter: LoadStats;
  };
  judges: Array<{ id: string; name: string; before: number; after: number }>;
  assignments: Array<{ judgeId: string; projectId: string; judgeName?: string; projectTitle?: string }>;
  shortfalls: Array<{ projectId: string; have: number; need: number; reason: string; projectTitle?: string; track: string | null }>;
};
export type CoverageRow = {
  id: string;
  title: string;
  externalId: string | null;
  track: { id: string; name: string } | null;
  team: string;
  duplicate: boolean;
  active: number;
  submitted: number;
  assignments: Array<{ id: string; status: AssignmentStatus; recusalReason: string | null; batchId: string | null; judge: { id: string; name: string }; conflict: boolean }>;
};
export type AssignmentsOverview = { submissionsClosed: boolean; hasRubric: boolean; projects: CoverageRow[] };
export type Batch = { id: string; name: string; algorithm: string; params: Record<string, unknown>; seed: number | null; createdAt: string; createdBy: { name: string } | null; assignments: number };

export type JudgingWindow = "not_open" | "open" | "closed";
export type JudgeCriterion = { id: string; key: string; label: string; description: string; weight: number; minScore: number; maxScore: number };
export type JudgeQueue = {
  event: { slug: string; name: string; judgingOpensAt: string; judgingClosesAt: string | null };
  judgingWindow: JudgingWindow;
  criteria: JudgeCriterion[];
  progress: { total: number; submitted: number; inProgress: number; todo: number; recused: number };
  assignments: Array<{
    id: string;
    status: AssignmentStatus;
    recusalReason: string | null;
    lastSavedAt: string | null;
    submittedAt: string | null;
    project: { id: string; title: string; tagline: string; thumbnailUrl: string | null; track: string | null; team: string };
  }>;
};
export type JudgeAssignment = {
  assignment: { id: string; status: AssignmentStatus; recusalReason: string | null };
  review: { status: "draft" | "submitted"; comment: string; submittedAt: string | null; updatedAt: string; scores: Record<string, number> } | null;
  project: {
    id: string;
    title: string;
    tagline: string;
    description: string;
    repoUrl: string | null;
    demoUrl: string | null;
    videoUrl: string | null;
    thumbnailUrl: string | null;
    techTags: string[];
    track: string | null;
    team: { name: string; members: string[] };
    answers: Array<{ label: string; type: QuestionType; value: string }>;
  };
  criteria: JudgeCriterion[];
  judgingWindow: JudgingWindow;
  nav: { position: number; total: number; previousId: string | null; nextId: string | null; nextUnscoredId: string | null };
};

export type Pace = "unassigned" | "waiting" | "done" | "on_track" | "behind" | "not_started" | "missed";
export type ProgressJudge = {
  id: string;
  externalId: string | null;
  name: string;
  email: string;
  tracks: string[];
  active: number;
  submitted: number;
  inProgress: number;
  notStarted: number;
  recused: number;
  lastActivityAt: string | null;
  medianMinutes: number | null;
  lastRemindedAt: string | null;
  pace: Pace;
  straggler: boolean;
};
export type JudgingProgress = {
  generatedAt: string;
  judgingWindow: JudgingWindow;
  window: { opensAt: string; closesAt: string | null; elapsed: number | null };
  target: number;
  totals: {
    reviews: number;
    submitted: number;
    inProgress: number;
    notStarted: number;
    recused: number;
    projects: number;
    projectsComplete: number;
    projectsUnreviewed: number;
    judges: number;
    judgesDone: number;
    stragglers: number;
  };
  timeline: { start: string; end: string; points: Array<{ t: string; n: number | null }> };
  judges: ProgressJudge[];
  tracks: Array<{ id: string | null; name: string; projects: number; assigned: number; submitted: number; complete: number }>;
  attention: Array<{
    id: string;
    title: string;
    externalId: string | null;
    team: string;
    track: string | null;
    assigned: number;
    submitted: number;
    reasons: string[];
    pending: Array<{ assignmentId: string; judgeId: string; judge: string; status: AssignmentStatus; straggler: boolean }>;
  }>;
};
export type RedistributePreview = {
  judge: { id: string; name: string };
  inputHash: string;
  seed: number;
  target: number;
  released: Array<{ assignmentId: string; projectId: string; title: string }>;
  moves: Array<{ projectId: string; title: string; judgeId: string; judge: string; loadAfter: number }>;
  unplaced: Array<{ projectId: string; title: string; have: number; need: number; reason: string }>;
};
export type ExportItem = { file: string; title: string; stage: string; description: string; rows: number | null; columns: number | null; unavailable: string | null; url: string };

export type RunOptions = { lambdaJudge: number; lambdaProject: number; minReviews: number; excludedJudges: Array<{ judgeId: string; reason: string }> };
export type RunSummary = {
  mu: number;
  sigma: number;
  iterations: number;
  converged: boolean;
  components: number;
  reviewsUsed: number;
  reviewsExcluded: number;
  projectsRanked: number;
  judgesUsed: number;
  topK: number;
  minReviews: number;
  rankAgreement: number | null;
  rankChanges: number;
  excluded: Array<{ judgeId: string; name: string; reason: string }>;
};
export type ResultRow = {
  projectId: string;
  externalId: string | null;
  title: string;
  tagline: string;
  thumbnailUrl: string | null;
  team: string;
  track: { id: string; name: string } | null;
  nReviews: number;
  rawScore: number | null;
  normalizedScore: number | null;
  stdError: number | null;
  rank: number | null;
  rawRank: number | null;
  rankLow: number | null;
  rankHigh: number | null;
  pTop: number | null;
  flags: string[];
};
export type JudgeStatRow = {
  judgeId: string;
  name: string;
  externalId: string | null;
  nReviews: number;
  rawMean: number | null;
  offset: number;
  stdDev: number | null;
  flags: string[];
  exclusionReason: string | null;
};
export type RunListItem = {
  id: string;
  method: string;
  createdAt: string;
  createdBy: string | null;
  inputHash: string;
  options: RunOptions;
  summary: RunSummary;
  componentCount: number;
  published: boolean;
  stale: boolean;
};
export type NormalizationState = {
  judgingWindow: JudgingWindow;
  publishedRunId: string | null;
  reviewsSubmitted: number;
  defaults: { lambdaJudge: number; lambdaProject: number; minReviews: number };
  judges: Array<{ id: string; name: string; externalId: string | null }>;
  runs: RunListItem[];
};
export type ResultsView = {
  summary: RunSummary;
  projects: ResultRow[];
  judges: JudgeStatRow[];
  options: RunOptions;
  /** Present for a saved run. */
  run?: { id: string; method: string; createdAt: string; createdBy: string | null; inputHash: string; published: boolean; stale: boolean };
  /** Present for a preview: the rank each project has in the published run. */
  publishedRanks?: Record<string, number | null> | null;
  inputHash?: string;
};
export type PublicResults = {
  event: { slug: string; name: string };
  publishedRun: { id: string; method: string; computedAt: string };
  tracks: Array<{ id: string; name: string }>;
  prizes: Array<{ id: string; name: string; value: string; rank: number | null; trackId: string | null }>;
  results: Array<{
    rank: number;
    score: number;
    reviews: number;
    provisional: boolean;
    project: { id: string; title: string; tagline: string; thumbnailUrl: string | null; team: string; members: string[]; track: { id: string; name: string } | null };
  }>;
};

export type IntegrityFlagType =
  | "outlier"
  | "comment_mismatch"
  | "identical_criteria"
  | "low_discrimination"
  | "disagrees_with_panel"
  | "rushed"
  | "fast_reviewer"
  | "copy_paste";
export type IntegrityFlag = {
  key: string;
  type: IntegrityFlagType;
  severity: "high" | "medium" | "low";
  judgeId: string;
  projectId: string | null;
  reviewId: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  judge: { id: string; name: string; externalId: string | null };
  project: { id: string; title: string; externalId: string | null } | null;
  resolution: { status: "dismissed" | "confirmed"; note: string; by: string | null; at: string } | null;
};
export type IntegrityReport = {
  summary: { reviewsChecked: number; judges: number; timedReviews: number; commentedReviews: number; flags: number; open: number; byType: Record<string, number> };
  reliability: { single: number; average: number; reviewsPerProject: number; projects: number; reliable: boolean } | null;
  flags: IntegrityFlag[];
};

export type VotingWindow = "off" | "not_open" | "open" | "closed";
export type VotingMode = "email" | "invite" | "accounts";
export type VoteStatus =
  | "allow"
  | "closed"
  | "voting_not_open"
  | "unauthenticated"
  | "email_unverified"
  | "invite_required"
  | "domain_not_allowed"
  | "staff_cannot_vote"
  | "duplicate_inbox"
  | "disposable_email";
export type BallotProject = {
  id: string;
  title: string;
  tagline: string;
  thumbnailUrl: string | null;
  position: number;
  team: string;
  members: string[];
  track: { id: string; name: string } | null;
  ownTeam: boolean;
};
export type VoteView = {
  event: { slug: string; name: string };
  window: VotingWindow;
  opensAt: string | null;
  closesAt: string | null;
  mode: VotingMode;
  votesPerVoter: number;
  voterDomains: string[];
  status: VoteStatus;
  me: { email: string | null; via: VotingMode } | null;
  ballot: { choices: string[]; receipt: string; updatedAt: string } | null;
  projects: BallotProject[];
};
export type VotingAdmin = {
  settings: { opensAt: string | null; closesAt: string | null; mode: VotingMode; votesPerVoter: number; voterDomains: string[] };
  window: VotingWindow;
  submissionsCloseAt: string;
  turnout: { voters: number; byKind: Partial<Record<VotingMode, number>>; ballots: number; choices: number; lastBallotAt: string | null };
  locked: boolean;
  invites: Array<{ label: string; total: number; redeemed: number; revoked: number; createdAt: string }>;
};

export type VoteSignalType = "shared_network" | "identical_ballots" | "fresh_accounts" | "address_pattern" | "surge" | "blind_votes";
export type VoteBallotSample = { ballotId: string; voter: string; network: string | null; castAt: string; accountAgeMinutes: number | null; quarantined: boolean };
export type VoteIncident = {
  key: string;
  severity: "high" | "medium" | "low";
  signals: Array<{ type: VoteSignalType; summary: string; evidence: Record<string, unknown> }>;
  ballotIds: string[];
  quarantined: number;
  projects: Array<{ id: string; title: string }>;
  sample: VoteBallotSample[];
  resolution: { status: string; note: string; by: string | null; at: string } | null;
};
export type VoteReview = {
  window: VotingWindow;
  summary: { ballots: number; quarantined: number; incidents: number; open: number };
  incidents: VoteIncident[];
  quarantinedBallots: Array<VoteBallotSample & { reason: string | null }>;
};

export type CommentsMode = "open" | "read_only" | "off";
export type CommentView = {
  id: string;
  state: "visible" | "hidden" | "deleted";
  body: string | null;
  author: { name: string; profile: string; avatarUrl: string | null; badges: Array<"team" | "organizer"> } | null;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReport: boolean;
  reportedByMe: boolean;
};
export type CommentThreadView = CommentView & { replies: CommentView[] };
export type CommentsResponse = { mode: CommentsMode; canComment: boolean; reason: string | null; count: number; threads: CommentThreadView[] };
export type ModerationItem = {
  id: string;
  body: string;
  project: { id: string; title: string };
  isReply: boolean;
  author: { name: string; email: string; accountAgeDays: number };
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  hidden: { at: string; by: string | null; auto: boolean; reason: string | null } | null;
  openReports: Array<{ reason: "spam" | "abuse" | "off_topic" | "other"; note: string; at: string; by: string }>;
  totalReports: number;
};
export type ModerationQueue = { mode: CommentsMode; counts: { reported: number; hidden: number; total: number }; items: ModerationItem[] };

export type VoteRankingRow = {
  rank: number;
  votes: number;
  share: number;
  project: { id: string; title: string; tagline: string; thumbnailUrl: string | null; team: string; members: string[]; track: { id: string; name: string } | null };
};
export type PositionCheck = {
  picks: number;
  buckets: Array<{ label: string; observed: number; expected: number }>;
  chi2: number;
  df: number;
  critical: number | null;
  enoughData: boolean;
  positionEffect: boolean;
};
export type VoteStats = { voters: number; votes: number; quarantinedBallots: number };
export type PublicVotingResults = {
  event: { slug: string; name: string };
  publishedAt: string;
  closedAt: string | null;
  votesPerVoter: number;
  method: string;
  stats: VoteStats;
  ranking: VoteRankingRow[];
  positionCheck: PositionCheck;
  ballotFile: { url: string; sha256: string; matches: boolean; ballots: number };
};
export type VotingResultsPreview = {
  published: boolean;
  publishedAt: string | null;
  ballotsHash: string;
  method: string;
  stats: VoteStats;
  ranking: VoteRankingRow[];
  positionCheck: PositionCheck;
};

// ── API tokens (T4) ──
export type ApiTokenScope = "read" | "write";
export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  state: "active" | "expired" | "revoked";
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
};
export type ApiTokenList = { tokens: ApiToken[]; limits: { maxActive: number; lifetimesDays: Array<number | null>; scopes: ApiTokenScope[] } };

// ── webhooks (T4) ──
export type DeliveryStatus = "pending" | "succeeded" | "failed";
export type WebhookEndpoint = {
  id: string;
  url: string;
  description: string;
  eventTypes: string[];
  format: "standard" | "slack" | "discord";
  active: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  failingSince: string | null;
  rotatingUntil: string | null;
  createdAt: string;
};
export type WebhookList = {
  webhooks: Array<WebhookEndpoint & { last24h: Record<DeliveryStatus, number>; lastAttempt: { lastAttemptAt: string; lastStatusCode: number | null; status: DeliveryStatus } | null }>;
  eventTypes: Array<{ type: string; description: string }>;
  limits: { maxWebhooks: number; maxAttempts: number; retryDelaysMs: number[] };
};
export type WebhookDelivery = {
  id: string;
  messageId: string;
  eventType: string;
  status: DeliveryStatus;
  attempts: number;
  nextAttemptAt: string | null;
  lastAttemptAt: string | null;
  lastStatusCode: number | null;
  lastError: string | null;
  deliveredAt: string | null;
  redeliveryOfId: string | null;
  createdAt: string;
};
export type WebhookDetail = { webhook: WebhookEndpoint; deliveries: WebhookDelivery[] };
export type WebhookDeliveryDetail = {
  delivery: WebhookDelivery & { payload: unknown };
  attempts: Array<{ attemptedAt: string; durationMs: number; statusCode: number | null; error: string | null; responseBody: string | null }>;
};

// ── signed records (T4) ──
export type RecordType = "judge_participation" | "participation";
export type RecordStatement = {
  id: string;
  type: RecordType;
  version: number;
  issuer: { name: string; url: string };
  kid: string;
  issuedAt: string;
  event: { slug: string; name: string; startedAt: string; endedAt: string };
  subject: { name: string; role: "judge" | "participant" };
  claims: {
    reviewsSubmitted?: number;
    projectsReviewed?: number;
    tracks?: string[];
    reviewsDigest?: string;
    team?: string;
    project?: { id: string; title: string; track: string | null; url: string };
    placement?: { rank: number; of: number; runId: string; method: string } | null;
    peoplesChoice?: { rank: number; votes: number } | null;
  };
  verify: string;
};
export type PublicRecord = {
  status: "current" | "superseded" | "revoked" | "invalid";
  signatureValid: boolean;
  statement: RecordStatement;
  signedText: string;
  signature: string;
  key: { kid: string; alg: "Ed25519"; publicKeyPem: string; retiredAt: string | null };
  revokedAt: string | null;
  revokedReason: string | null;
  supersededById: string | null;
  event: { slug: string; logoUrl: string | null; bannerUrl: string | null };
};
export type RecordSummary = {
  id: string;
  type: RecordType;
  status: "current" | "superseded" | "revoked";
  subject: { name: string; email?: string };
  claims: RecordStatement["claims"];
  kid: string;
  issuedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  supersededById: string | null;
  event?: { slug: string; name: string; logoUrl: string | null };
};
export type RecordsAdmin = { issuable: boolean; judgingClosesAt: string | null; resultsPublished: boolean; peoplesChoicePublished: boolean; records: RecordSummary[] };

// ── profiles ──
export type MyProfile = {
  id: string; email: string; name: string; handle: string; headline: string; bio: string; avatarUrl: string | null; location: string;
  website: string | null; githubUrl: string | null; linkedinUrl: string | null; skills: string[]; hasPassword: boolean; createdAt: string;
};
export type PublicProfile = {
  user: { id: string; name: string; handle: string; headline: string; bio: string; avatarUrl: string | null; location: string; website: string | null; githubUrl: string | null; linkedinUrl: string | null; skills: string[]; joinedAt: string };
  stats: { hackathons: number; projects: number; podiums: number; judged: number };
  history: Array<{
    event: { slug: string; name: string; logoUrl: string | null; endedAt: string };
    roles: Array<"participant" | "judge" | "organizer">;
    team: string | null;
    project: { id: string; title: string; tagline: string; thumbnailUrl: string | null } | null;
    placement: { rank: number; of: number } | null;
  }>;
  certificates: Array<{ id: string; type: "judge_participation" | "participation"; issuedAt: string; event: { slug: string; name: string } }>;
};
