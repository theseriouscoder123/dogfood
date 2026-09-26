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
  submissionsOpenAt: string;
  submissionsCloseAt: string;
  judgingOpensAt: string | null;
  judgingClosesAt: string | null;
  submissionWindow: SubmissionWindow;
  projectCount: number;
};

export type Track = { id: string; externalId: string | null; name: string; description: string };

export type EventDetail = {
  event: {
    slug: string;
    name: string;
    description: string;
    timezone: string;
    registrationOpensAt: string | null;
    submissionsOpenAt: string;
    submissionsCloseAt: string;
    judgingOpensAt: string | null;
    judgingClosesAt: string | null;
    maxTeamSize: number;
    submissionWindow: SubmissionWindow;
    resultsPublished: boolean;
  };
  tracks: Track[];
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
