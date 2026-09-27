// The order an event's dates must follow. Checked on every create/update so an
// organizer gets a readable error instead of a database CHECK violation.
export type Schedule = {
  registrationOpensAt: Date | null;
  submissionsOpenAt: Date;
  submissionsCloseAt: Date;
  judgingOpensAt: Date | null;
  judgingClosesAt: Date | null;
};

export function scheduleProblems(s: Schedule): string[] {
  const problems: string[] = [];
  if (s.registrationOpensAt && s.registrationOpensAt > s.submissionsOpenAt)
    problems.push("registrationOpensAt must not be after submissionsOpenAt");
  if (s.submissionsOpenAt >= s.submissionsCloseAt) problems.push("submissionsOpenAt must be before submissionsCloseAt");
  if (s.judgingOpensAt && s.judgingOpensAt < s.submissionsCloseAt)
    problems.push("judgingOpensAt must not be before submissionsCloseAt");
  if (s.judgingOpensAt && s.judgingClosesAt && s.judgingOpensAt >= s.judgingClosesAt)
    problems.push("judgingOpensAt must be before judgingClosesAt");
  if (!s.judgingOpensAt && s.judgingClosesAt) problems.push("judgingClosesAt needs judgingOpensAt");
  return problems;
}
