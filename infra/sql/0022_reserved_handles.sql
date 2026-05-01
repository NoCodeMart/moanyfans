-- Reserved handles registry. Seeded from the Python module for diffability,
-- but stored in the DB so the admin console can release entries (e.g. when
-- a real Klopp signs up, or we want to gift @ARSENAL to the actual club).

CREATE TABLE IF NOT EXISTS reserved_handles (
  handle_lc    text PRIMARY KEY,
  category     text NOT NULL,            -- 'club' | 'manager' | 'player' | 'pundit'
  reserved_at  timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,              -- nullable; once set, handle is grabbable
  released_by  uuid REFERENCES users(id),
  notes        text
);

CREATE INDEX IF NOT EXISTS reserved_handles_active_idx
  ON reserved_handles (handle_lc) WHERE released_at IS NULL;
