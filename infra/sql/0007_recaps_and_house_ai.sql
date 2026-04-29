-- 0007: AI match recaps + house AI dedup log.
BEGIN;

CREATE TABLE IF NOT EXISTS match_recaps (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  fixture_id    uuid NOT NULL UNIQUE REFERENCES fixtures(id) ON DELETE CASCADE,
  headline      text NOT NULL,
  body          text NOT NULL,
  model         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS match_recaps_fixture_idx ON match_recaps (fixture_id);

-- Dedup log so house AI doesn't post the same thing twice on a restart.
CREATE TABLE IF NOT EXISTS house_ai_log (
  kind          text NOT NULL,           -- e.g. 'hot_take', 'rage_ranker_weekly'
  ref           text NOT NULL,           -- fixture_id::text, ISO week, etc.
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, ref)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON match_recaps, house_ai_log TO moanyfans;

COMMIT;
