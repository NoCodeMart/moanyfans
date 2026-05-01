-- Polls — a moan kind with up to 4 options + per-user vote tracking.
ALTER TYPE moan_kind ADD VALUE IF NOT EXISTS 'POLL';

-- Stored as a JSONB array of {label, votes} so we don't need 4 join tables.
-- Vote uniqueness enforced by poll_votes table below.
ALTER TABLE moans
  ADD COLUMN IF NOT EXISTS poll_options jsonb,
  ADD COLUMN IF NOT EXISTS poll_closes_at timestamptz;

CREATE TABLE IF NOT EXISTS poll_votes (
  moan_id     uuid NOT NULL REFERENCES moans(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  choice_idx  smallint NOT NULL CHECK (choice_idx >= 0 AND choice_idx < 4),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (moan_id, user_id)
);

CREATE INDEX IF NOT EXISTS poll_votes_moan_idx ON poll_votes (moan_id, choice_idx);

GRANT ALL ON TABLE poll_votes TO moanyfans;
