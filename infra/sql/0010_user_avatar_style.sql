-- 0010: avatar customisation columns on users.
BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_style text;

GRANT SELECT, UPDATE ON users TO moanyfans;

COMMIT;
