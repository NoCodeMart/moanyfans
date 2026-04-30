import type { Team } from '../lib/api';

type CrestTeam = Pick<Team, 'id' | 'name' | 'primary_color' | 'secondary_color'> & {
  short_name?: string | null;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function initialsOf(team: CrestTeam): string {
  if (team.short_name && team.short_name.length <= 4) return team.short_name.toUpperCase();
  return team.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3).toUpperCase();
}

const SHAPES: { id: 'shield' | 'pointed' | 'round' | 'hex'; path: string }[] = [
  { id: 'shield',  path: 'M6 4 H58 V32 Q58 56 32 60 Q6 56 6 32 Z' },
  { id: 'pointed', path: 'M32 2 L60 12 L60 36 L32 62 L4 36 L4 12 Z' },
  { id: 'round',   path: 'M32 2 a30 30 0 1 0 0.001 0 Z' },
  { id: 'hex',     path: 'M32 2 L58 16 L58 48 L32 62 L6 48 L6 16 Z' },
];

type Pattern =
  | 'halves-v' | 'halves-h' | 'stripes' | 'hoops'
  | 'sash' | 'quartered' | 'chevron' | 'solid-bordered';

const PATTERNS: Pattern[] = [
  'halves-v', 'halves-h', 'stripes', 'hoops',
  'sash', 'quartered', 'chevron', 'solid-bordered',
];

function PatternFill({ pattern, a, b }: { pattern: Pattern; a: string; b: string }) {
  switch (pattern) {
    case 'halves-v':
      return (<>
        <rect x="0" y="0" width="32" height="64" fill={a} />
        <rect x="32" y="0" width="32" height="64" fill={b} />
      </>);
    case 'halves-h':
      return (<>
        <rect x="0" y="0" width="64" height="32" fill={a} />
        <rect x="0" y="32" width="64" height="32" fill={b} />
      </>);
    case 'stripes':
      return (<>
        <rect width="64" height="64" fill={a} />
        {[8, 24, 40, 56].map(x => (
          <rect key={x} x={x} y="0" width="6" height="64" fill={b} />
        ))}
      </>);
    case 'hoops':
      return (<>
        <rect width="64" height="64" fill={a} />
        {[8, 24, 40, 56].map(y => (
          <rect key={y} x="0" y={y} width="64" height="6" fill={b} />
        ))}
      </>);
    case 'sash':
      return (<>
        <rect width="64" height="64" fill={a} />
        <path d="M-8 40 L40 -8 L56 8 L8 56 Z" fill={b} />
      </>);
    case 'quartered':
      return (<>
        <rect x="0" y="0" width="32" height="32" fill={a} />
        <rect x="32" y="0" width="32" height="32" fill={b} />
        <rect x="0" y="32" width="32" height="32" fill={b} />
        <rect x="32" y="32" width="32" height="32" fill={a} />
      </>);
    case 'chevron':
      return (<>
        <rect width="64" height="64" fill={a} />
        <path d="M0 16 L32 38 L64 16 L64 30 L32 52 L0 30 Z" fill={b} />
      </>);
    case 'solid-bordered':
    default:
      return (<>
        <rect width="64" height="64" fill={a} />
        <rect x="6" y="6" width="52" height="52" fill="none" stroke={b} strokeWidth="3" />
      </>);
  }
}

export function TeamCrest({ team, size = 48, withInitials = true }: {
  team?: CrestTeam | null;
  size?: number;
  withInitials?: boolean;
}) {
  if (!team) return null;
  const h = hash(team.id || team.name);
  const shape = SHAPES[h % SHAPES.length];
  const pattern = PATTERNS[(h >>> 8) % PATTERNS.length];
  const initials = initialsOf(team);
  const a = team.primary_color || '#0a0908';
  const b = team.secondary_color || '#fffdf2';
  const cpId = `crest-cp-${team.id || hash(team.name)}`;
  const fontSize = initials.length >= 3 ? 22 : 28;
  return (
    <span className="crest" style={{ width: size, height: size, display: 'inline-block' }}>
      <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
        <defs>
          <clipPath id={cpId}>
            <path d={shape.path} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${cpId})`}>
          <PatternFill pattern={pattern} a={a} b={b} />
          {withInitials && (
            <text
              x="32"
              y={fontSize === 22 ? 39 : 41}
              textAnchor="middle"
              fontFamily="var(--font-display, 'Anton', system-ui)"
              fontSize={fontSize}
              fontWeight={900}
              fill={b}
              stroke={a}
              strokeWidth="0.6"
              paintOrder="stroke"
            >{initials}</text>
          )}
        </g>
        <path d={shape.path} fill="none" stroke="var(--ink, #0a0908)" strokeWidth="2" />
      </svg>
    </span>
  );
}
