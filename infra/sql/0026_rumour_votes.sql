-- Community voting on transfer rumours.
-- Three outcomes: HERE_WE_GO (lean confirmed), BOLLOCKS (lean busted),
-- GET_A_GRIP (this rumour is nonsense). Aggregate vote drives the lean
-- bar shown under each RUMOUR card and feeds the Prophet leaderboard
-- (who called it right early once an admin officially marks it).

CREATE TABLE IF NOT EXISTS rumour_votes (
  moan_id  uuid NOT NULL REFERENCES moans(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vote     text NOT NULL CHECK (vote IN ('HERE_WE_GO', 'BOLLOCKS', 'GET_A_GRIP')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (moan_id, user_id)
);

CREATE INDEX IF NOT EXISTS rumour_votes_moan_idx ON rumour_votes (moan_id);
CREATE INDEX IF NOT EXISTS rumour_votes_user_idx ON rumour_votes (user_id);
