// Visual identity helpers: avatars, generated covers and the logo mark.
// Covers are generated from the item's name, so an event or project without an
// uploaded image still gets a distinctive, stable look instead of a grey box.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Hand-picked pairs that read well with white text in both themes.
const PALETTES: Array<[string, string, string]> = [
  ["#3346f0", "#7b5cff", "#ff6b35"],
  ["#0f766e", "#14b8a6", "#fde047"],
  ["#1e3a8a", "#2563eb", "#38bdf8"],
  ["#7c2d92", "#c026d3", "#fb7185"],
  ["#9a3412", "#ea580c", "#fbbf24"],
  ["#14532d", "#16a34a", "#a3e635"],
  ["#1f2937", "#4b5563", "#f59e0b"],
  ["#831843", "#db2777", "#fdba74"],
  ["#0c4a6e", "#0284c7", "#5eead4"],
  ["#3b0764", "#6d28d9", "#22d3ee"],
];

export function paletteFor(seed: string) {
  return PALETTES[hash(seed) % PALETTES.length]!;
}

export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const parts = words.filter((w) => /^[\p{L}]/u.test(w)).length ? words.filter((w) => /^[\p{L}]/u.test(w)) : words;
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1]![0] : parts[0]?.[1] ?? "")).toUpperCase();
}

export function Avatar({ name, src, size = 32, className = "" }: { name: string; src?: string | null; size?: number; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" width={size} height={size} className={`inline-block shrink-0 rounded-full object-cover ring-2 ring-surface ${className}`} style={{ width: size, height: size }} />;
  }
  const [a, b] = paletteFor(name);
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 place-items-center rounded-full font-bold text-white ring-2 ring-surface ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, ${a}, ${b})` }}
    >
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names, max = 4, size = 28 }: { names: string[]; max?: number; size?: number }) {
  const shown = names.slice(0, max);
  return (
    <span className="flex -space-x-2">
      {shown.map((n, i) => (
        <Avatar key={i} name={n} size={size} />
      ))}
      {names.length > max && (
        <span className="inline-grid place-items-center rounded-full bg-surface-3 text-[11px] font-bold text-ink-2 ring-2 ring-surface" style={{ width: size, height: size }}>
          +{names.length - max}
        </span>
      )}
    </span>
  );
}

/** Uploaded image if there is one, otherwise a generated gradient with a geometric motif. */
export function Cover({ seed, src, label, className = "", rounded = "rounded-2xl", monogram = true }: {
  seed: string;
  src?: string | null;
  label?: string;
  className?: string;
  rounded?: string;
  monogram?: boolean;
}) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={label ?? ""} className={`object-cover ${rounded} ${className}`} />;
  }
  const [a, b, c] = paletteFor(seed);
  const h = hash(seed);
  const motif = h % 3;
  const rot = (h >> 3) % 360;
  return (
    <div aria-hidden className={`relative overflow-hidden ${rounded} ${className}`} style={{ background: `linear-gradient(135deg, ${a} 0%, ${b} 100%)` }}>
      <svg className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 400 225">
        <defs>
          <radialGradient id={`g${h}`} cx="80%" cy="10%" r="70%">
            <stop offset="0" stopColor={c} stopOpacity="0.75" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width="400" height="225" fill={`url(#g${h})`} />
        <g transform={`rotate(${rot} 300 60)`} fill="none" stroke="white" strokeOpacity="0.16" strokeWidth="1.5">
          {motif === 0 && [40, 70, 100, 130, 160].map((r) => <circle key={r} cx="300" cy="60" r={r} />)}
          {motif === 1 && [0, 1, 2, 3, 4, 5, 6].map((i) => <line key={i} x1={180 + i * 34} y1="-40" x2={60 + i * 34} y2="260" />)}
          {motif === 2 && [0, 1, 2, 3].map((i) => <rect key={i} x={230 - i * 28} y={-10 - i * 28} width={140 + i * 56} height={140 + i * 56} rx="18" />)}
        </g>
      </svg>
      {monogram && label && (
        <span className="absolute bottom-3 left-4 font-display text-4xl font-extrabold tracking-tight text-white/90 drop-shadow-sm">{initials(label)}</span>
      )}
    </div>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M10 9h6.2c4.6 0 7.8 2.9 7.8 7s-3.2 7-7.8 7H10V9z" fill="none" stroke="white" strokeWidth="3" strokeLinejoin="round" />
      <circle cx="24.5" cy="8" r="3.2" fill="var(--accent)" stroke="var(--primary)" strokeWidth="1.5" />
    </svg>
  );
}

/** Square logo: the uploaded image, or a gradient tile with the name's initials. */
export function LogoTile({ seed, src, name, className = "" }: { seed: string; src?: string | null; name: string; className?: string }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" className={`rounded-2xl bg-surface object-cover ${className}`} />;
  }
  const [a, b] = paletteFor(seed);
  return (
    <div aria-hidden className={`grid place-items-center rounded-2xl font-display font-extrabold text-white ${className}`} style={{ background: `linear-gradient(145deg, ${a}, ${b})` }}>
      <span className="text-[length:inherit]">{initials(name)}</span>
    </div>
  );
}
