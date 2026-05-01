-- Transfer rumours: dedicated moan kind + structured fields.
-- Composer captures player/route/fee/source; the dedicated TRANSFER ROOM
-- page filters on kind = 'RUMOUR' and renders them as transfer cards.

ALTER TYPE moan_kind ADD VALUE IF NOT EXISTS 'RUMOUR';

ALTER TABLE moans
  ADD COLUMN IF NOT EXISTS rumour_player     text,
  ADD COLUMN IF NOT EXISTS rumour_from_team  uuid REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS rumour_to_team    uuid REFERENCES teams(id),
  ADD COLUMN IF NOT EXISTS rumour_fee        text,
  ADD COLUMN IF NOT EXISTS rumour_source_url text,
  -- Resolution tracking (Layer 3 — Prophet leaderboard hook).
  -- Stays NULL until an admin marks the rumour CONFIRMED or BUSTED.
  ADD COLUMN IF NOT EXISTS rumour_status     text,
  ADD COLUMN IF NOT EXISTS rumour_resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS moans_rumour_feed_idx
  ON moans (created_at DESC)
  WHERE kind = 'RUMOUR' AND deleted_at IS NULL AND status = 'PUBLISHED';
