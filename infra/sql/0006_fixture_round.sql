-- Add round number to fixtures so we can target sync to specific rounds.
ALTER TABLE fixtures ADD COLUMN IF NOT EXISTS round int;
CREATE INDEX IF NOT EXISTS fixtures_round_idx
  ON fixtures (competition, round)
  WHERE round IS NOT NULL;
