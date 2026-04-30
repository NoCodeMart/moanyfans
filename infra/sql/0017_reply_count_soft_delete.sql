-- Make reply_count respect soft-deletes too. Previously the trigger only fired
-- on INSERT/DELETE, so flipping deleted_at via UPDATE left the parent's
-- reply_count stale (e.g. parent showed "REPLY 1" after the only reply was
-- soft-deleted).

CREATE OR REPLACE FUNCTION public.sync_reply_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_moan_id IS NOT NULL
     AND NEW.deleted_at IS NULL THEN
    UPDATE moans SET reply_count = reply_count + 1 WHERE id = NEW.parent_moan_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_moan_id IS NOT NULL
     AND OLD.deleted_at IS NULL THEN
    UPDATE moans SET reply_count = GREATEST(0, reply_count - 1)
     WHERE id = OLD.parent_moan_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.parent_moan_id IS NOT NULL THEN
    -- Soft-delete transition (NULL -> NOT NULL) decrements;
    -- restore (NOT NULL -> NULL) increments.
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      UPDATE moans SET reply_count = GREATEST(0, reply_count - 1)
       WHERE id = NEW.parent_moan_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      UPDATE moans SET reply_count = reply_count + 1 WHERE id = NEW.parent_moan_id;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS moans_reply_count_sync ON moans;
CREATE TRIGGER moans_reply_count_sync
  AFTER INSERT OR UPDATE OR DELETE ON moans
  FOR EACH ROW EXECUTE FUNCTION sync_reply_count();

-- Reconcile any drift left from soft-deleted replies that ran under the old
-- trigger. Recomputes reply_count for every parent that has at least one
-- soft-deleted child.
UPDATE moans p
   SET reply_count = (
     SELECT count(*) FROM moans c
      WHERE c.parent_moan_id = p.id AND c.deleted_at IS NULL
   )
 WHERE p.id IN (
   SELECT DISTINCT parent_moan_id FROM moans
    WHERE parent_moan_id IS NOT NULL AND deleted_at IS NOT NULL
 );
