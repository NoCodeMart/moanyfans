-- 0003_seed_guest_user.sql
-- Default user for development/testing when AUTH_ENABLED=false.
-- All API requests act as this user when no auth is configured.

BEGIN;

INSERT INTO users (handle, email, external_id, team_id, avatar_seed, bio)
SELECT 'GUEST_TESTER',
       'guest@moanyfans.local',
       'guest:dev-default',
       (SELECT id FROM teams WHERE slug = 'man-utd'),
       'GT',
       'Anonymous tester. Auth is currently disabled — every request acts as me.'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'GUEST_TESTER');

COMMIT;
