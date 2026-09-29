# Builds planning/test-checklist.html from TEST-PLAN.md and TEST-PLAN-2.md.
#   python planning/build-checklist.py
# Every "- [ ] **ID** text" line becomes a case; ## / ### headings become sections.
import html, json, pathlib, re

HERE = pathlib.Path(__file__).parent
SOURCES = [("TEST-PLAN.md", "Plan 1: T1 + T2"), ("TEST-PLAN-2.md", "Plan 2: T3 + T4")]

# Cases run first when time is short: the smoke tests plus one or two per feature and role.
PRIORITY = set("""
S-1 S-2 S-3 S-4 S-5 S-6 S-7
AU-2 AU-4 AU-5 BR-2 BR-4 BR-6 TM-1 TM-2 SB-2 SB-3 SB-4 SB-9
JC-1 JC-3 JC-9 PR-1 RS-1 RS-7 IN-1 EX-1
S2-1 S2-2 S2-4 V-5 CM-4
S2-5 S2-7 S2-9 S2-10
PW-1 PW-3
N-1 N-2 N-3 N-4 N-8 N-10 N-11 N-12 SEC-1 SEC-2 SEC-3
""".split())

# Expectations that changed after the plans were written.
UPDATES = {
    "OR-7": "Updated: any signed-in user can now host (the event starts as a private draft). HOSTING=admins restores admin-only.",
    "S2-5": "Updated: the API now has 162 documented operations.",
    "EX-1": "Updated: there are now 11 CSV files (comparisons.csv was added).",
    "SB-8": "Updated: status changes (unsubmit/withdraw) after the deadline are refused and audited too.",
}

# Built after the plans were written.
EXTRA = [
    ("Plan 3: added since", "Product polish and hardening", [
        ("N-1", "**Host a hackathon** (any signed-in user): 5 steps. A preset fills all five dates; wrong date order is flagged on step 2; the review step lists everything. **Create** opens the organizer console with the tracks, prizes and rubric already there."),
        ("N-2", "The new event is a **private draft**: as another user its URL is a 404. After **Publish** on the banner, it's listed on Hackathons."),
        ("N-3", "`/u/priya`: photo or initials, headline, skills, links, hackathon history with placement, and her certificate. **No email address** anywhere on the page."),
        ("N-4", "As organizer, the **bell** shows unread alerts (a judge falling behind, suspicious voting). The notifications page: filter unread, mark all read, the count goes to 0."),
        ("N-5", "Demo Jam → **Find a team**: teams with room and people looking; search by skill narrows the list."),
        ("N-6", "As organizer, post an **Update** on Demo Jam with notify on. It appears on the Updates tab and in participants' bells."),
        ("N-7", "Manage → Webhooks: the Slack/Discord/Custom tiles; **Test**, **Pause/Resume** and **Delivery log** work inline."),
        ("N-8", "**Dashboard** is role-aware: an organizer sees Organizing tiles with progress; Priya sees Building and **Open to join**."),
        ("N-9", "Mobile (390 px): the event tabs scroll and the active tab stays in view; on a sub-tab the status card sits under the content."),
        ("N-10", "**View switcher:** as `organizer@dogfood.local`, the header shows **Organizer** (Participant / Organizer). Organizer view: only Organizing tiles and organizer deadlines. Participant view: no Manage tab on events. Switching to Organizer while on an event opens its Manage console. Priya (one role) sees no switcher."),
        ("N-11", "**Already signed in:** open `/login` or `/register` while signed in → \"You're already signed in\" with **Continue** and **Sign out and use another account** (which shows the login form)."),
        ("N-12", "**Verify page for non-developers:** `/verify/<id>` explains \"How do we know this is real?\" in three plain steps, has **Copy link to share**, and keeps the commands, key and signed text under a collapsed **For developers** section."),
        ("SEC-1", "**Login throttling:** 10 wrong passwords for one account, then the 11th attempt (even with the right password) → 429 \"Too many failed sign-ins\". Another account still signs in."),
        ("SEC-2", "**No account takeover:** register with the email of a judge who was invited but hasn't set a password → \"We've emailed a link to set your password\"; you are **not** signed in."),
        ("SEC-3", "**Bare embed:** signed in as organizer, view source of `/embed/sample-hack-2026`: no site header and no user name."),
        ("SEC-4", "**Forged IP ignored:** a request with `X-Forwarded-For: 6.6.6.6` is recorded in the audit log with the real address, not 6.6.6.6."),
    ]),
]

def md_inline(s: str) -> str:
    s = html.escape(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    s = re.sub(r"`(.+?)`", r"<code>\1</code>", s)
    s = re.sub(r"\[(.+?)\]\((https?://[^)]+)\)", r'<a href="\2" target="_blank">\1</a>', s)
    s = re.sub(r"(?<![\"=>])(https?://[^\s<),]+)", r'<a href="\1" target="_blank">\1</a>', s)
    return s

groups = []
for fname, title in SOURCES:
    sections, current, sub = [], None, None
    for line in (HERE / fname).read_text(encoding="utf8").splitlines():
        h = re.match(r"^(#{2,3}) (.+)$", line)
        if h:
            if len(h.group(1)) == 2: current = h.group(2).strip(); sub = None
            else: sub = h.group(2).strip()
            continue
        m = re.match(r"^- \[ \] \*\*([A-Z0-9-]+)\*\*:? ?(.*)$", line) or re.match(r"^- \[ \] \*\*([A-Z0-9-]+) ([^*]+)\*\*:? ?(.*)$", line)
        if not m: continue
        cid = m.group(1)
        text = m.group(2) if m.lastindex == 2 else f"**{m.group(2)}:** {m.group(3)}"
        name = f"{current} › {sub}" if sub else current
        if not sections or sections[-1]["name"] != name: sections.append({"name": name, "cases": []})
        sections[-1]["cases"].append({"id": cid, "html": md_inline(text), "note": UPDATES.get(cid, ""), "p": cid in PRIORITY})
    groups.append({"title": title, "sections": sections})
for title, name, cases in EXTRA:
    groups.append({"title": title, "sections": [{"name": name, "cases": [{"id": c, "html": md_inline(t), "note": "", "p": c in PRIORITY} for c, t in cases]}]})

data = json.dumps(groups, ensure_ascii=False)
total = sum(len(s["cases"]) for g in groups for s in g["sections"])
page = (HERE / "checklist-template.html").read_text(encoding="utf8").replace("/*DATA*/[]", data).replace("{{TOTAL}}", str(total))
(HERE / "test-checklist.html").write_text(page, encoding="utf8")
print(f"wrote planning/test-checklist.html: {total} cases, {sum(1 for g in groups for s in g['sections'] for c in s['cases'] if c['p'])} priority")
