-- Web Push subscriptions per user. One row per browser/device.
-- Endpoint is the canonical identifier; if a user re-subscribes from the same
-- browser the endpoint matches, the row is upserted.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     text        NOT NULL UNIQUE,
  p256dh       text        NOT NULL,
  auth         text        NOT NULL,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions(user_id);

-- Track which notifications have been pushed so the dispatcher doesn't double-send.
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS pushed_at timestamptz;

-- Partial index keeps the dispatcher's "find unpushed" query cheap as the
-- table grows: we only ever look at NULLs from the recent window.
CREATE INDEX IF NOT EXISTS notifications_unpushed_idx
  ON notifications (created_at)
  WHERE pushed_at IS NULL;
