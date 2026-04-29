-- 0005_seed_fixtures.sql
-- Seed a few fixtures so the live moan-along screen has something to show:
--   • 1 currently LIVE fixture (kickoff 30 min ago) with running events
--   • 1 finished fixture (FT) for archive
--   • 4 upcoming fixtures spread over the next 7 days
-- Idempotent: only inserts when the fixtures table is empty.

BEGIN;

DO $$
DECLARE
  arsenal      uuid;
  spurs        uuid;
  manutd       uuid;
  liverpool    uuid;
  chelsea      uuid;
  newcastle    uuid;
  celtic       uuid;
  rangers      uuid;
  leeds        uuid;
  burnley      uuid;
  live_fix     uuid;
  past_fix     uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM fixtures LIMIT 1) THEN
    RAISE NOTICE 'Fixtures already seeded, skipping.';
    RETURN;
  END IF;

  SELECT id INTO arsenal   FROM teams WHERE slug = 'arsenal';
  SELECT id INTO spurs     FROM teams WHERE slug = 'spurs';
  SELECT id INTO manutd    FROM teams WHERE slug = 'man-utd';
  SELECT id INTO liverpool FROM teams WHERE slug = 'liverpool';
  SELECT id INTO chelsea   FROM teams WHERE slug = 'chelsea';
  SELECT id INTO newcastle FROM teams WHERE slug = 'newcastle';
  SELECT id INTO celtic    FROM teams WHERE slug = 'celtic';
  SELECT id INTO rangers   FROM teams WHERE slug = 'rangers';
  SELECT id INTO leeds     FROM teams WHERE slug = 'leeds';
  SELECT id INTO burnley   FROM teams WHERE slug = 'burnley';

  -- LIVE: kicked off 30 minutes ago, currently 0-2
  INSERT INTO fixtures (competition, home_team_id, away_team_id, kickoff_at,
                        status, home_score, away_score)
  VALUES ('Premier League', manutd, arsenal, now() - interval '30 minutes',
          'LIVE', 0, 2)
  RETURNING id INTO live_fix;

  -- Live thread events for the live fixture
  INSERT INTO live_thread_events (fixture_id, minute, text, source) VALUES
    (live_fix, 0, 'KICK OFF — Old Trafford under floodlights. 73,000 in attendance, all already moaning.', 'EDITORIAL'),
    (live_fix, 4, 'RED CARD-WORTHY TACKLE on the Arsenal full-back. Ref waves play on. United fans cheering. The state of refereeing.', 'EDITORIAL'),
    (live_fix, 12, 'GOAL — ARSENAL (0-1). Walked it in. United defence treating zonal marking like a Tinder profile they swiped left on.', 'EDITORIAL'),
    (live_fix, 18, 'United keeper just punched it straight to an Arsenal striker. Fortunately the striker was so confused he fell over.', 'EDITORIAL'),
    (live_fix, 26, 'GOAL — ARSENAL (0-2). Free header, six yards out, no marker within postcode. United fans heading to the pubs early.', 'EDITORIAL'),
    (live_fix, 31, '£80m striker just fluffed an open net from inside the six-yard box. The crowd has gone silent. The boos start at minute 32.', 'EDITORIAL');

  -- FT: Yesterday, Spurs beat Chelsea — for the FT/archive demo
  INSERT INTO fixtures (competition, home_team_id, away_team_id, kickoff_at,
                        status, home_score, away_score)
  VALUES ('Premier League', spurs, chelsea, now() - interval '1 day - 3 hours',
          'FT', 3, 0)
  RETURNING id INTO past_fix;

  INSERT INTO live_thread_events (fixture_id, minute, text, source) VALUES
    (past_fix, 11, 'GOAL — SPURS (1-0). Chelsea defence enacting performance art. £400m well spent.', 'EDITORIAL'),
    (past_fix, 56, 'GOAL — SPURS (2-0). Chelsea midfield invisible. Press conference will be a mess.', 'EDITORIAL'),
    (past_fix, 88, 'GOAL — SPURS (3-0). Chelsea fans visibly leaving in droves. Empty seats by minute 80.', 'EDITORIAL'),
    (past_fix, 90, 'FULL TIME. SPURS 3-0 CHELSEA. Boehly out chants audible from the away end.', 'EDITORIAL');

  -- UPCOMING: 4 spread out fixtures
  INSERT INTO fixtures (competition, home_team_id, away_team_id, kickoff_at, status) VALUES
    ('Premier League',         liverpool, newcastle, now() + interval '1 day',     'SCHEDULED'),
    ('Premier League',         chelsea,   manutd,    now() + interval '2 days',    'SCHEDULED'),
    ('Scottish Premiership',   celtic,    rangers,   now() + interval '3 days',    'SCHEDULED'),
    ('Championship',           leeds,     burnley,   now() + interval '5 days',    'SCHEDULED');

  RAISE NOTICE 'Seeded 6 fixtures + % live events',
    (SELECT count(*) FROM live_thread_events);
END $$;

COMMIT;
