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
