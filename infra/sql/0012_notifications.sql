-- 0012: hook DB triggers to write into notifications, and add 'followed' kind.
BEGIN;

ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'followed';
ALTER TYPE notification_kind ADD VALUE IF NOT EXISTS 'reaction';

GRANT SELECT, INSERT, UPDATE ON notifications TO moanyfans;

COMMIT;

-- The triggers must be created in their own transaction since they
-- reference the new enum value added above (PG quirk: enum additions
-- are not visible to subsequent statements in the same tx).
BEGIN;

CREATE OR REPLACE FUNCTION notify_on_follow() RETURNS trigger AS $$
BEGIN
  IF NEW.follower_id <> NEW.followed_id THEN
    INSERT INTO notifications (user_id, kind, payload)
    VALUES (
      NEW.followed_id,
      'followed',
      jsonb_build_object(
        'follower_id', NEW.follower_id::text,
        'follower_handle',
          (SELECT handle FROM users WHERE id = NEW.follower_id)
      )
    );
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS follows_notify ON follows;
CREATE TRIGGER follows_notify
  AFTER INSERT ON follows
  FOR EACH ROW EXECUTE FUNCTION notify_on_follow();


CREATE OR REPLACE FUNCTION notify_on_reply() RETURNS trigger AS $$
DECLARE
  parent_user_id uuid;
BEGIN
  IF NEW.parent_moan_id IS NOT NULL THEN
    SELECT user_id INTO parent_user_id FROM moans WHERE id = NEW.parent_moan_id;
    IF parent_user_id IS NOT NULL AND parent_user_id <> NEW.user_id THEN
      INSERT INTO notifications (user_id, kind, payload)
      VALUES (
        parent_user_id,
        'replied',
        jsonb_build_object(
          'reply_id', NEW.id::text,
          'parent_id', NEW.parent_moan_id::text,
          'replier_handle', (SELECT handle FROM users WHERE id = NEW.user_id),
          'preview', left(NEW.text, 140)
        )
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS moans_reply_notify ON moans;
CREATE TRIGGER moans_reply_notify
  AFTER INSERT ON moans
  FOR EACH ROW EXECUTE FUNCTION notify_on_reply();


CREATE OR REPLACE FUNCTION notify_on_reaction() RETURNS trigger AS $$
DECLARE
  author_id uuid;
  author_handle text;
  preview text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT user_id, left(text, 100) INTO author_id, preview
      FROM moans WHERE id = NEW.moan_id;
    IF author_id IS NOT NULL AND author_id <> NEW.user_id THEN
      SELECT handle INTO author_handle FROM users WHERE id = NEW.user_id;
      INSERT INTO notifications (user_id, kind, payload)
      VALUES (
        author_id,
        'reaction',
        jsonb_build_object(
          'reactor_handle', author_handle,
          'moan_id', NEW.moan_id::text,
          'reaction', NEW.kind::text,
          'preview', preview
        )
      );
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reactions_notify ON reactions;
CREATE TRIGGER reactions_notify
  AFTER INSERT ON reactions
  FOR EACH ROW EXECUTE FUNCTION notify_on_reaction();

COMMIT;
