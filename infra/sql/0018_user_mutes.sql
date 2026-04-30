-- Mute is the lighter sibling of block: the muter stops seeing the muted's
-- moans + replies, but the muted user is unaware and can still see + react
-- to the muter's content. Twitter's classic "soft hide".

CREATE TABLE IF NOT EXISTS user_mutes (
  muter_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id != muted_id)
);
CREATE INDEX IF NOT EXISTS user_mutes_muter_idx ON user_mutes(muter_id);
