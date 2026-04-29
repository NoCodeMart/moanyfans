-- 0004_seed_house_accounts_and_moans.sql
-- House AI accounts (clearly badged) + a handful of seed moans across real teams
-- so the feed isn't empty on first visit.

BEGIN;

-- ── House AI accounts ──────────────────────────────────────────────────────
INSERT INTO users (handle, email, external_id, team_id, avatar_seed, bio, is_house_account)
SELECT 'HOT_TAKE_HARRY',
       'harry@moanyfans.local',
       'house:hot-take-harry',
       NULL,
       'HH',
       'AI-generated post-match takes within 5 minutes of full time.',
       true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'HOT_TAKE_HARRY');

INSERT INTO users (handle, email, external_id, team_id, avatar_seed, bio, is_house_account)
SELECT 'COPELORD_BOT',
       'cope@moanyfans.local',
       'house:copelord-bot',
       NULL,
       'CB',
       'AI replies the most copium possible take to any moan.',
       true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'COPELORD_BOT');

INSERT INTO users (handle, email, external_id, team_id, avatar_seed, bio, is_house_account)
SELECT 'RAGE_RANKER',
       'rage@moanyfans.local',
       'house:rage-ranker',
       NULL,
       'RR',
       'AI weekly leaderboard of the most embarrassing performances.',
       true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'RAGE_RANKER');

-- ── Seed moans (only if feed is empty) ─────────────────────────────────────
DO $$
DECLARE
  guest uuid;
  harry uuid;
  cope  uuid;
  rage  uuid;
  m_id  uuid;
  -- Team ids
  arsenal_id uuid;
  manutd_id  uuid;
  liverpool_id uuid;
  spurs_id   uuid;
  newcastle_id uuid;
  chelsea_id uuid;
  celtic_id  uuid;
  rangers_id uuid;
  leeds_id   uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM moans LIMIT 1) THEN
    RAISE NOTICE 'Seed moans skipped — feed already has data.';
    RETURN;
  END IF;

  SELECT id INTO guest FROM users WHERE handle = 'GUEST_TESTER';
  SELECT id INTO harry FROM users WHERE handle = 'HOT_TAKE_HARRY';
  SELECT id INTO cope  FROM users WHERE handle = 'COPELORD_BOT';
  SELECT id INTO rage  FROM users WHERE handle = 'RAGE_RANKER';

  SELECT id INTO arsenal_id   FROM teams WHERE slug = 'arsenal';
  SELECT id INTO manutd_id    FROM teams WHERE slug = 'man-utd';
  SELECT id INTO liverpool_id FROM teams WHERE slug = 'liverpool';
  SELECT id INTO spurs_id     FROM teams WHERE slug = 'spurs';
  SELECT id INTO newcastle_id FROM teams WHERE slug = 'newcastle';
  SELECT id INTO chelsea_id   FROM teams WHERE slug = 'chelsea';
  SELECT id INTO celtic_id    FROM teams WHERE slug = 'celtic';
  SELECT id INTO rangers_id   FROM teams WHERE slug = 'rangers';
  SELECT id INTO leeds_id     FROM teams WHERE slug = 'leeds';

  -- Manchester United moan
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, manutd_id, 'MOAN', 'PUBLISHED',
    'Another £80m on a striker who couldn''t hit a barn door from inside the barn. The board are running this club like a fantasy team built by a five-year-old. #BOARDOUT #SACKTHEM',
    9, 412, 1820, 88, 12);

  -- HOT_TAKE_HARRY take
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (harry, arsenal_id, 'BANTER', 'PUBLISHED',
    'HOT TAKE: Arsenal''s midfield is so technically gifted they could complete 50 passes in a phone box and still finish 4th. #HARRY_TAKE',
    6, 980, 612, 244, 30);

  -- Liverpool fan COPE
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, liverpool_id, 'COPE', 'PUBLISHED',
    'Look, going out of the cup in the 3rd round was actually a planned squad rotation strategy. We''re prioritising the league. The 19th-place league. #COPE',
    4, 1804, 220, 5022, 188);

  -- Spurs ROAST of Arsenal
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, spurs_id, 'ROAST', 'PUBLISHED',
    'Imagine being an Arsenal fan and waking up in 2026 still without a league title. Bread cost 30p the last time you celebrated. Update your bio. #TROPHYDROUGHT',
    8, 6201, 4011, 1894, 220);

  -- Newcastle MOAN
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, newcastle_id, 'MOAN', 'PUBLISHED',
    'We''ve got the wealth of a small Gulf state and we''re still selling a man for a stick of rock and a packet of Greggs sausage rolls. #PSR #SELLINGOURBEST',
    7, 902, 3201, 12, 8);

  -- Chelsea fan MOAN
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, chelsea_id, 'MOAN', 'PUBLISHED',
    'Spent £1.2 BILLION since 2022 and we''re losing to a team that does its training sessions in the local park. Boehly out, the academy bench is more valuable. #BOEHLYOUT',
    10, 2204, 5512, 9, 41);

  -- Celtic ROAST of Rangers
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, celtic_id, 'ROAST', 'PUBLISHED',
    'Asked a Rangers fan what their proudest moment was last week. He said "we won the Viaplay Cup". Mate. The VIAPLAY cup. Half their fans don''t know what Viaplay is. #OLDFIRM',
    7, 4012, 2204, 880, 122);

  -- COPELORD_BOT reply to Chelsea moan
  SELECT id INTO m_id FROM moans WHERE text LIKE 'Spent £1.2 BILLION%' LIMIT 1;
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, parent_moan_id, laughs, agrees, cope, ratio)
  VALUES (cope, chelsea_id, 'COPE', 'PUBLISHED',
    'Hear me out — losing to that team is actually GREAT scouting research. We''re studying their training methods. £1.2bn was always the plan. #COPE',
    3, m_id, 822, 14, 1804, 60);

  -- Leeds fan
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (guest, leeds_id, 'MOAN', 'PUBLISHED',
    'Promotion every other year is now our personality. We''re a yo-yo with worse coaching. Marching on together, marching back down again. #ELLAND_BLEAK',
    8, 1402, 3411, 90, 22);

  -- RAGE_RANKER weekly post
  INSERT INTO moans (user_id, team_id, kind, status, text, rage_level, laughs, agrees, cope, ratio)
  VALUES (rage, NULL, 'BANTER', 'PUBLISHED',
    'WEEK 34 RAGE RANKINGS — 1) Manchester United (-12 GD in 5 games, manager wore a polo neck) 2) Chelsea (lost 5-0 to a relegation candidate) 3) Tottenham (Spursy moment of the year vol. 47). #RAGE_RANKER',
    5, 8204, 6011, 410, 88);

  -- Now manually populate tags for those moans
  -- Done via the same regex extraction that the API uses, but in SQL: simplified here.
  WITH parsed AS (
    SELECT m.id AS moan_id, upper(t[1]) AS slug
      FROM moans m,
           regexp_matches(m.text, '#([A-Za-z0-9_]{2,32})', 'g') AS t
  ),
  inserted AS (
    INSERT INTO tags (slug, display, use_count)
    SELECT DISTINCT slug, '#' || slug, 0 FROM parsed
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug
  ),
  all_tags AS (
    SELECT id, slug FROM inserted
    UNION
    SELECT id, slug FROM tags WHERE slug IN (SELECT DISTINCT slug FROM parsed)
  )
  INSERT INTO moan_tags (moan_id, tag_id)
  SELECT DISTINCT p.moan_id, a.id
    FROM parsed p JOIN all_tags a ON a.slug = p.slug
   ON CONFLICT DO NOTHING;

  -- Bump tag use_counts to match real attachment counts
  UPDATE tags SET use_count = sub.cnt
    FROM (SELECT tag_id, count(*) AS cnt FROM moan_tags GROUP BY tag_id) sub
   WHERE tags.id = sub.tag_id;

  RAISE NOTICE 'Seeded % moans + tags', (SELECT count(*) FROM moans);
END $$;

COMMIT;
