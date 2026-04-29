import { type CSSProperties, type ReactNode } from 'react';
import { TEAMS, type Team, type User, type Reactions } from '../data';

type WordmarkProps = {
  size?: number;
  primary?: string;
  accent?: string;
  fansBg?: string;
  fansFg?: string;
  spin?: boolean;
};

export function Wordmark({
  size = 56,
  primary = 'var(--ink)',
  accent = 'var(--red)',
  fansBg,
  fansFg,
  spin = true,
}: WordmarkProps) {
  const _fansBg = fansBg || accent;
  const _fansFg = fansFg || 'var(--cream)';
  return (
    <span className="wm" style={{ fontSize: size }}>
      <span className="wm-row">
        <span style={{ color: primary }}>M</span>
        <span className="wm-o" style={{ background: accent, color: 'var(--cream)' }}>
          <span className="wm-o-inner" />
        </span>
        <span style={{ color: primary }}>ANY</span>
      </span>
      <span className="wm-fans" style={{ background: _fansBg, color: _fansFg }}>
        FANS<span className="wm-tm">™</span>
      </span>
      {spin && <span className="wm-stamp" style={{ color: accent }}>EST. 2026 · NO MERCY · ZERO TROPHIES</span>}
    </span>
  );
}

type HalftoneProps = { color?: string; size?: number; opacity?: number; style?: CSSProperties };

export function Halftone({ color = 'rgba(10,9,8,0.18)', size = 8, opacity = 1, style = {} }: HalftoneProps) {
  return (
    <div
      className="halftone"
      style={{
        backgroundImage: `radial-gradient(${color} 1.2px, transparent 1.4px)`,
        backgroundSize: `${size}px ${size}px`,
        opacity,
        ...style,
      }}
    />
  );
}

export function Ticker({ items, speed = 60 }: { items: string[]; speed?: number }) {
  return (
    <div className="ticker">
      <div className="ticker-track" style={{ animationDuration: `${speed}s` }}>
        {[...items, ...items, ...items].map((it, i) => (
          <span key={i} className="ticker-item">
            <span className="ticker-bullet">●</span> {it}
          </span>
        ))}
      </div>
    </div>
  );
}

export function Stamp({
  children,
  rotate = -8,
  color = 'var(--red)',
  size = 14,
}: {
  children: ReactNode;
  rotate?: number;
  color?: string;
  size?: number;
}) {
  return (
    <span
      className="stamp"
      style={{ transform: `rotate(${rotate}deg)`, borderColor: color, color, fontSize: size }}
    >
      {children}
    </span>
  );
}

export function Crest({ team, size = 48 }: { team?: Team; size?: number }) {
  if (!team) return null;
  const hash = [...team.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const shape = hash % 4;
  const stripes = (hash % 3) + 2;
  const stripeColors = [team.primary, team.secondary];
  const initials = team.name.split(' ').map(w => w[0]).join('').slice(0, 3);
  return (
    <span className="crest" style={{ width: size, height: size }}>
      <svg viewBox="0 0 48 48" width={size} height={size}>
        <defs>
          <clipPath id={`cp-${team.id}`}>
            {shape === 0 && <path d="M4 4 H44 V28 Q44 44 24 46 Q4 44 4 28 Z" />}
            {shape === 1 && <circle cx="24" cy="24" r="22" />}
            {shape === 2 && <path d="M24 2 L46 24 L24 46 L2 24 Z" />}
            {shape === 3 && <path d="M24 2 L44 14 L44 34 L24 46 L4 34 L4 14 Z" />}
          </clipPath>
        </defs>
        <g clipPath={`url(#cp-${team.id})`}>
          <rect width="48" height="48" fill={stripeColors[0]} />
          {Array.from({ length: stripes }).map((_, i) => (
            <rect
              key={i}
              x={(i * 48) / stripes}
              y="0"
              width={48 / stripes / 2}
              height="48"
              fill={stripeColors[1]}
              opacity="0.85"
            />
          ))}
          <text
            x="24"
            y="30"
            textAnchor="middle"
            fontFamily="var(--font-display)"
            fontSize="18"
            fontWeight="900"
            fill={stripeColors[1]}
            stroke={stripeColors[0]}
            strokeWidth="0.5"
          >
            {initials}
          </text>
        </g>
        <g fill="none" stroke="var(--ink)" strokeWidth="1.5">
          {shape === 0 && <path d="M4 4 H44 V28 Q44 44 24 46 Q4 44 4 28 Z" />}
          {shape === 1 && <circle cx="24" cy="24" r="22" />}
          {shape === 2 && <path d="M24 2 L46 24 L24 46 L2 24 Z" />}
          {shape === 3 && <path d="M24 2 L44 14 L44 34 L24 46 L4 34 L4 14 Z" />}
        </g>
      </svg>
    </span>
  );
}

export function Avatar({ user, size = 40 }: { user?: User; size?: number }) {
  if (!user) return null;
  const team = TEAMS.find(t => t.id === user.team);
  return (
    <span className="avatar" style={{ width: size, height: size, background: team?.primary || '#000' }}>
      <span className="avatar-grain" />
      <span className="avatar-init" style={{ fontSize: size * 0.42 }}>{user.avatar}</span>
    </span>
  );
}

export function Tag({
  children,
  onClick,
  active,
}: {
  children: ReactNode;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button className={'tag' + (active ? ' tag-active' : '')} onClick={onClick} type="button">
      {children}
    </button>
  );
}

type ReactionKey = keyof Reactions;

export const REACTIONS: { key: ReactionKey; label: string; emoji: string; color: string }[] = [
  { key: 'laughs', label: 'LAUGHS', emoji: 'HA', color: 'var(--yellow)' },
  { key: 'agrees', label: 'AGREES', emoji: '✓', color: 'var(--green)' },
  { key: 'cope',   label: 'COPE',   emoji: '😭', color: 'var(--blue)' },
  { key: 'ratio',  label: 'RATIO',  emoji: 'X', color: 'var(--red)' },
];

export function ReactionBar({
  counts,
  onReact,
  active,
}: {
  counts: Reactions;
  onReact: (k: ReactionKey) => void;
  active: ReactionKey | null;
}) {
  return (
    <div className="reactions">
      {REACTIONS.map(r => (
        <button
          key={r.key}
          type="button"
          className={'reaction' + (active === r.key ? ' reaction-active' : '')}
          onClick={() => onReact(r.key)}
          style={{ ['--rc' as string]: r.color } as CSSProperties}
        >
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-label">{r.label}</span>
          <span className="reaction-count">{(counts[r.key] || 0).toLocaleString()}</span>
        </button>
      ))}
    </div>
  );
}

export function Headline({
  children,
  size = 96,
  color = 'var(--ink)',
  shadow = 'var(--red)',
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  shadow?: string;
}) {
  return (
    <h1
      className="headline"
      style={{ fontSize: size, color, textShadow: `4px 4px 0 ${shadow}, 8px 8px 0 var(--ink)` }}
    >
      {children}
    </h1>
  );
}

export function Placeholder({
  label,
  ratio = '16/9',
  tone = 'red',
}: {
  label: string;
  ratio?: string;
  tone?: 'red' | 'ink' | 'orange';
}) {
  const bg = tone === 'red' ? 'var(--red)' : tone === 'ink' ? 'var(--ink)' : 'var(--orange)';
  return (
    <div className="placeholder" style={{ aspectRatio: ratio, background: bg }}>
      <div className="placeholder-stripes" />
      <span className="placeholder-label">{label}</span>
    </div>
  );
}
