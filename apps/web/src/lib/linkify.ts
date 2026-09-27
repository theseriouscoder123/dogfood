// Split plain text into text runs and http(s) links, so comments can show clickable links without
// ever rendering HTML. Trailing punctuation stays outside the link ("see https://x.org.").
export function linkify(body: string): Array<{ text: string; href?: string }> {
  const out: Array<{ text: string; href?: string }> = [];
  const re = /\bhttps?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/gi;
  let last = 0;
  for (const m of body.matchAll(re)) {
    if (m.index > last) out.push({ text: body.slice(last, m.index) });
    out.push({ text: m[0], href: m[0] });
    last = m.index + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last) });
  return out;
}
