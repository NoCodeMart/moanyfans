-- 0008: link moans to fixtures so they can appear in the live thread.
BEGIN;

ALTER TABLE moans
  ADD COLUMN IF NOT EXISTS fixture_id   uuid REFERENCES fixtures(id),
  ADD COLUMN IF NOT EXISTS match_minute int,
  ADD COLUMN IF NOT EXISTS side         text;  -- 'HOME' | 'AWAY' | 'NEUTRAL' | null

CREATE INDEX IF NOT EXISTS moans_fixture_idx
  ON moans (fixture_id, created_at DESC)
  WHERE fixture_id IS NOT NULL AND deleted_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON moans TO moanyfans;

COMMIT;
