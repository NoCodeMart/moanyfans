-- 0011: follow / followers.
BEGIN;

CREATE TABLE IF NOT EXISTS follows (
  follower_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE INDEX IF NOT EXISTS follows_followed_idx ON follows (followed_id);
CREATE INDEX IF NOT EXISTS follows_follower_idx ON follows (follower_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS follower_count  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_follow_counts() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
    UPDATE users SET follower_count  = follower_count  + 1 WHERE id = NEW.followed_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE id = OLD.follower_id;
    UPDATE users SET follower_count  = GREATEST(0, follower_count  - 1) WHERE id = OLD.followed_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS follows_count_sync ON follows;
CREATE TRIGGER follows_count_sync
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION sync_follow_counts();

GRANT SELECT, INSERT, DELETE ON follows TO moanyfans;

COMMIT;
