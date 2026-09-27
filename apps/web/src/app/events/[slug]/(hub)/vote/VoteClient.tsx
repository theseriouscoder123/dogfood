"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CheckCircle2, Copy, ExternalLink, Heart, Info, Lock, Mail, Shuffle, Ticket, UserCheck } from "lucide-react";
import { send } from "@/lib/client";
import type { BallotProject, VoteView } from "@/lib/types";
import { formatDate } from "@/lib/format";
import { Countdown } from "@/components/Countdown";
import { Button, buttonClass, ErrorText, inputClass } from "@/components/ui";
import { AvatarStack, Cover } from "@/components/visuals";

export function VoteClient({ slug, data, loggedInEmail, code, published }: { slug: string; data: VoteView; loggedInEmail: string | null; code: string | null; published: boolean }) {
  const canVote = data.status === "allow";
  const showBallot = canVote || (data.status === "closed" && data.ballot !== null);
  return (
    <div className="space-y-6">
      <Header data={data} published={published} />
      {published && (
        <Link href={`/events/${slug}/peoples-choice`} className="flex items-center justify-between gap-3 rounded-2xl border border-accent/40 bg-accent-soft px-5 py-4 text-sm font-semibold text-ink hover:border-accent">
          <span>The People&apos;s Choice results are out. See who won, check your receipt, or recount every ballot yourself.</span>
          <span className="shrink-0 text-accent">View results →</span>
        </Link>
      )}
      {showBallot ? (
        <Ballot slug={slug} data={data} readOnly={!canVote} />
      ) : (
        <Gate slug={slug} data={data} loggedInEmail={loggedInEmail} code={code} />
      )}
    </div>
  );
}

function Header({ data, published }: { data: VoteView; published: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-3xl bg-hero p-6 text-hero-ink sm:p-8">
      <div className="hero-grid absolute inset-0" />
      <div className="absolute -right-20 -top-24 size-72 rounded-full bg-[#ff6b35] opacity-30 blur-[90px]" />
      <div className="relative grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-sm font-semibold text-white/60">Community vote</p>
          <h2 className="mt-1 text-3xl font-extrabold sm:text-4xl">Pick your favourites</h2>
          <p className="mt-2 max-w-xl text-white/75">
            You have <b className="text-white">{data.votesPerVoter} votes</b>. Give them to the projects you&apos;d most like to see win People&apos;s Choice. You can change
            your picks until voting closes.
          </p>
          <p className="mt-3 inline-flex items-center gap-2 text-xs text-white/60">
            <Shuffle className="size-3.5" /> Projects appear in a random order that&apos;s unique to you, so nobody gets an edge from being listed first.
          </p>
        </div>
        <div className="w-full rounded-2xl border border-white/10 bg-white/[0.06] p-5 backdrop-blur lg:w-80">
          {data.window === "open" && data.closesAt ? (
            <>
              <p className="mb-2 text-xs font-semibold text-white/60">Voting closes in</p>
              <Countdown to={data.closesAt} onDark />
            </>
          ) : data.window === "not_open" && data.opensAt ? (
            <>
              <p className="mb-2 text-xs font-semibold text-white/60">Voting opens in</p>
              <Countdown to={data.opensAt} onDark />
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="size-4" /> Voting closed {data.closesAt && formatDate(data.closesAt)}.
              {published ? " The results are out." : " Results are published after the organizers review the ballots."}
            </p>
          )}
          <p className="mt-4 flex items-start gap-2 text-xs text-white/60">
            <Info className="mt-0.5 size-3.5 shrink-0" /> Vote counts stay sealed until voting closes, for everyone, including the organizers.
          </p>
        </div>
      </div>
    </section>
  );
}

function Gate({ slug, data, loggedInEmail, code }: { slug: string; data: VoteView; loggedInEmail: string | null; code: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(loggedInEmail ?? "");
  const [sent, setSent] = useState(false);
  const [codeInput, setCodeInput] = useState(code ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = `/events/${slug}/vote`;
  const autoTried = useRef(false);

  async function sendLink(to: string) {
    setPending(true);
    const r = await send("POST", "/api/auth/link", { email: to, next });
    setPending(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setSent(true);
  }

  async function redeem(c: string) {
    setPending(true);
    const r = await send("POST", `/api/events/${slug}/vote/redeem`, { code: c });
    setPending(false);
    if (!r.ok) return setError(r.message);
    router.replace(next);
    router.refresh();
  }

  // A QR code / link carries ?code=…: redeem it straight away.
  useEffect(() => {
    if (data.status === "invite_required" && code && !autoTried.current) {
      autoTried.current = true;
      void redeem(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = (icon: React.ReactNode, title: string, body: React.ReactNode, action?: React.ReactNode) => (
    <div className="mx-auto max-w-xl rounded-2xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
      <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="text-xl font-bold">{title}</h3>
      <div className="mt-2 text-sm text-muted">{body}</div>
      {action && <div className="mt-6">{action}</div>}
      {error && (
        <div className="mt-4 text-left">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );

  if (data.status === "voting_not_open") return card(<Lock className="size-5" />, "Voting hasn't opened yet", "Come back when the countdown above reaches zero.");
  if (data.status === "closed") return card(<Lock className="size-5" />, "Voting has closed", "Results will be published here after the organizers review the ballots.");
  if (data.status === "staff_cannot_vote")
    return card(<UserCheck className="size-5" />, "Organizers and judges don't vote here", "You already have your own say in the results, so the community vote is left to everyone else.");
  if (data.status === "domain_not_allowed")
    return card(<Mail className="size-5" />, "This vote is limited to certain email domains", <>Voting is open to addresses at {data.voterDomains.map((d) => `@${d}`).join(", ")}. Sign in with one of those to vote.</>);
  if (data.status === "disposable_email")
    return card(<Mail className="size-5" />, "Throwaway addresses can't vote", "Temporary inboxes make it too easy to vote many times. Sign in with an email address you keep.");
  if (data.status === "duplicate_inbox")
    return card(<Mail className="size-5" />, "This inbox has already voted", "Another account using the same email inbox already holds a ballot in this event. One inbox, one ballot.");

  if (data.status === "invite_required")
    return card(
      <Ticket className="size-5" />,
      "Enter your ballot code",
      "The organizers handed out single-use ballot codes for this vote (on your badge, ticket or email).",
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void redeem(codeInput);
        }}
      >
        <input value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="VOTE-XXXX-XXXX-XXXX" className={`${inputClass} mt-0 font-mono uppercase`} autoFocus required />
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Open my ballot"}
        </Button>
      </form>,
    );

  if (data.mode === "accounts" && data.status === "unauthenticated")
    return card(<UserCheck className="size-5" />, "Log in to vote", "Voting in this event needs a Dogfood account.", <Link href={`/login?next=${encodeURIComponent(next)}`} className={buttonClass("primary", "lg")}>Log in</Link>);

  // Verified email: new visitors and signed-in accounts that haven't confirmed their address yet.
  if (sent)
    return card(
      <Mail className="size-5" />,
      "Check your inbox",
      <>
        We sent a one-time voting link to <b className="text-ink">{email}</b>. It expires in 30 minutes. Opening it confirms your address and brings you straight back here.
      </>,
    );
  return card(
    <Mail className="size-5" />,
    loggedInEmail ? "Confirm your email to vote" : "Vote with your email",
    loggedInEmail ? (
      <>Each inbox gets one ballot. We&apos;ll send a one-time link to {loggedInEmail} to confirm it&apos;s yours.</>
    ) : (
      <>No account or password needed. Each inbox gets one ballot; we&apos;ll email you a one-time link to open yours.</>
    ),
    loggedInEmail ? (
      <Button size="lg" disabled={pending} onClick={() => sendLink(loggedInEmail)}>
        <Mail className="size-4" /> {pending ? "Sending…" : "Email me a voting link"}
      </Button>
    ) : (
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void sendLink(email);
        }}
      >
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={`${inputClass} mt-0`} autoFocus required />
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send my link"}
        </Button>
      </form>
    ),
  );
}

function Ballot({ slug, data, readOnly }: { slug: string; data: VoteView; readOnly: boolean }) {
  const [choices, setChoices] = useState<string[]>(data.ballot?.choices ?? []);
  const [receipt, setReceipt] = useState(data.ballot?.receipt ?? null);
  const [state, setState] = useState<"idle" | "saving" | "saved">(data.ballot ? "saved" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const left = data.votesPerVoter - choices.length;

  async function toggle(p: BallotProject) {
    if (readOnly || p.ownTeam) return;
    const next = choices.includes(p.id) ? choices.filter((c) => c !== p.id) : [...choices, p.id];
    if (next.length > data.votesPerVoter) return setError(`You've used all ${data.votesPerVoter} votes. Remove one to pick another.`);
    const before = choices;
    setChoices(next);
    setState("saving");
    const r = await send<{ ballot: { choices: string[]; receipt: string } }>("PUT", `/api/events/${slug}/ballot`, { projectIds: next });
    if (!r.ok) {
      setChoices(before);
      setState("idle");
      return setError(r.message);
    }
    setError(null);
    setReceipt(r.data.ballot.receipt);
    setState("saved");
  }

  const picked = data.projects.filter((p) => choices.includes(p.id));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {error && (
          <div className="mb-4">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.projects.map((p) => {
            const on = choices.includes(p.id);
            const blocked = !on && left <= 0;
            return (
              <li key={p.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-surface shadow-card transition ${on ? "border-accent ring-2 ring-accent/30" : "border-line"}`}>
                <Cover seed={p.id} src={p.thumbnailUrl} label={p.title} rounded="rounded-none" className="aspect-[16/7] w-full sm:aspect-[16/9]" />
                <div className="flex flex-1 flex-col p-4">
                  <h3 className="font-bold leading-snug">{p.title}</h3>
                  <p className="mt-1 line-clamp-2 flex-1 text-sm text-muted">{p.tagline}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-muted">
                    <AvatarStack names={p.members} size={20} />
                    <span className="truncate">
                      {p.team}
                      {p.track && ` · ${p.track.name}`}
                    </span>
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Link href={`/events/${slug}/projects/${p.id}`} target="_blank" className={buttonClass("ghost", "sm", "flex-1")}>
                      <ExternalLink className="size-4" /> View
                    </Link>
                    {p.ownTeam ? (
                      <span className="inline-flex h-8 flex-1 items-center justify-center rounded-[10px] bg-surface-2 text-[13px] font-semibold text-muted">Your team</span>
                    ) : (
                      <button
                        onClick={() => toggle(p)}
                        disabled={readOnly || blocked}
                        aria-pressed={on}
                        className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-semibold transition disabled:opacity-40 ${
                          on ? "bg-accent text-white hover:brightness-105" : "border border-line bg-surface text-ink hover:border-accent hover:text-accent"
                        }`}
                      >
                        <Heart className={`size-4 ${on ? "fill-current" : ""}`} /> {on ? "Voted" : "Vote"}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <aside className="order-first space-y-4 lg:sticky lg:top-[132px] lg:order-none lg:self-start">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Your ballot</h3>
            <span className="text-xs font-semibold text-muted">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : ""}</span>
          </div>
          <div className="mt-3 flex gap-1.5" aria-label={`${choices.length} of ${data.votesPerVoter} votes used`}>
            {Array.from({ length: data.votesPerVoter }, (_, i) => (
              <span key={i} className={`grid size-8 place-items-center rounded-full ${i < choices.length ? "bg-accent text-white" : "border-2 border-dashed border-line-strong text-line-strong"}`}>
                <Heart className={`size-4 ${i < choices.length ? "fill-current" : ""}`} />
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm text-muted">{readOnly ? "Voting has closed; this is your final ballot." : left > 0 ? `${left} vote${left === 1 ? "" : "s"} left` : "All votes used. Remove one to change your mind."}</p>
          {picked.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm">
              {picked.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 shrink-0 text-accent" /> <span className="truncate">{p.title}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {receipt && (
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
            <h3 className="font-bold">Your receipt</h3>
            <button
              onClick={async () => {
                await navigator.clipboard?.writeText(receipt).catch(() => undefined);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="mt-2 flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 font-mono text-base font-bold tracking-wider"
              title="Copy"
            >
              {receipt} {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4 text-muted" />}
            </button>
            <p className="mt-2 text-xs text-muted">
              Keep this code. After voting closes, every ballot is published anonymously by its receipt, so you can check yours was counted exactly as you cast it, and anyone can
              recount the result.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
