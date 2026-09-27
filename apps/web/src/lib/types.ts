// Response shapes of the API endpoints the web app uses.
export type Role = "participant" | "judge" | "organizer";
export type SubmissionWindow = "not_open" | "open" | "closed";

export type Me = {
  user: { id: string; email: string; name: string; isAdmin: boolean } | null;
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
    team: { id: string; name: string; members: Array<{ name: string; role: string }> };
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
export type ExportItem = { file: string; title: string; stage: string; description: string; rows: number; columns: number; url: string };
