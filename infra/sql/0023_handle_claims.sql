-- Handle claims: when a real Klopp/Salah/Liverpool wants their reserved name.
-- Public submits via /claims; admins review via the admin console.
CREATE TABLE IF NOT EXISTS handle_claims (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle_lc     text NOT NULL,
  claimant_name text NOT NULL,
  email         text NOT NULL,
  email_lc      text NOT NULL,
  social_proof  text NOT NULL,           -- URLs / verified-account links
  message       text,                    -- optional cover note
  ip            text,
  user_agent    text,
  status        text NOT NULL DEFAULT 'PENDING',  -- PENDING|APPROVED|DENIED
  reviewed_by   uuid REFERENCES users(id),
  reviewed_at   timestamptz,
  review_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handle_claims_status_idx
  ON handle_claims (status, created_at DESC);
CREATE INDEX IF NOT EXISTS handle_claims_handle_idx
  ON handle_claims (handle_lc);

-- Anti-spam: at most one PENDING claim per (email, handle) at a time.
CREATE UNIQUE INDEX IF NOT EXISTS handle_claims_dedupe_pending_idx
  ON handle_claims (email_lc, handle_lc) WHERE status = 'PENDING';

GRANT ALL ON TABLE handle_claims TO moanyfans;
