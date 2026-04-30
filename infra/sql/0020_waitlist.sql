CREATE TABLE IF NOT EXISTS waitlist_emails (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  email_lc    text NOT NULL,
  ip          text,
  user_agent  text,
  source      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_emails_email_lc_uidx
  ON waitlist_emails (email_lc);

CREATE INDEX IF NOT EXISTS waitlist_emails_created_at_idx
  ON waitlist_emails (created_at DESC);
