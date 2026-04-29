-- 0001_init.sql — Moanyfans v1 schema
-- Run order: psql -d moanyfans -f 0001_init.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- UUID v7 generator (time-ordered, sortable, no extension needed on PG16+ but we hand-roll for portability)
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid AS $$
DECLARE
  ts_ms bigint;
  rand_bytes bytea;
  uuid_bytes bytea;
BEGIN
  ts_ms := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  rand_bytes := gen_random_bytes(10);
  uuid_bytes := set_byte(set_byte(set_byte(set_byte(set_byte(set_byte(rand_bytes,
    0, ((get_byte(rand_bytes, 0) & 15) | 112)),
    1, get_byte(rand_bytes, 1)),
    2, ((get_byte(rand_bytes, 2) & 63) | 128)),
    3, get_byte(rand_bytes, 3)),
    4, get_byte(rand_bytes, 4)),
    5, get_byte(rand_bytes, 5));
  RETURN encode(
    decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || uuid_bytes,
    'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ── teams ──────────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug            text UNIQUE NOT NULL,
  name            text NOT NULL,
  short_name      text NOT NULL,
  city            text NOT NULL,
  country         text NOT NULL DEFAULT 'GB',
  league          text NOT NULL,
  sport           text NOT NULL DEFAULT 'football',
  primary_color   text NOT NULL,
  secondary_color text NOT NULL,
  founded_year    int,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teams_league_idx ON teams (league);
CREATE INDEX teams_sport_idx ON teams (sport);
CREATE TRIGGER teams_updated BEFORE UPDATE ON teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── users ──────────────────────────────────────────────────────────────────
-- Stack Auth supplies external_id; everything else is ours.
CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  external_id         text UNIQUE NOT NULL,
  handle              text UNIQUE NOT NULL CHECK (handle ~* '^[A-Z0-9_]{3,20}$'),
  email               text UNIQUE NOT NULL,
  team_id             uuid REFERENCES teams(id),
  team_set_at         timestamptz,
  avatar_seed         text,
  bio                 text,
  is_admin            boolean NOT NULL DEFAULT false,
  is_house_account    boolean NOT NULL DEFAULT false,
  is_suspended        boolean NOT NULL DEFAULT false,
  suspended_reason    text,
  moan_score          int NOT NULL DEFAULT 0,
  roast_score         int NOT NULL DEFAULT 0,
  streak_days         int NOT NULL DEFAULT 0,
  last_post_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX users_team_idx ON users (team_id) WHERE deleted_at IS NULL;
CREATE INDEX users_handle_lower_idx ON users (lower(handle));
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── moans ──────────────────────────────────────────────────────────────────
CREATE TYPE moan_kind AS ENUM ('MOAN', 'ROAST', 'COPE', 'BANTER');
CREATE TYPE moan_status AS ENUM ('PUBLISHED', 'HELD', 'REJECTED', 'REMOVED');

CREATE TABLE moans (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id             uuid NOT NULL REFERENCES users(id),
  team_id             uuid REFERENCES teams(id),
  target_user_id      uuid REFERENCES users(id),
  parent_moan_id      uuid REFERENCES moans(id),
  kind                moan_kind NOT NULL,
  status              moan_status NOT NULL DEFAULT 'PUBLISHED',
  text                text NOT NULL CHECK (length(text) > 0 AND length(text) <= 500),
  rage_level          int NOT NULL DEFAULT 0 CHECK (rage_level BETWEEN 0 AND 10),
  -- denormalised reaction counts (updated via trigger below)
  laughs              int NOT NULL DEFAULT 0,
  agrees              int NOT NULL DEFAULT 0,
  cope                int NOT NULL DEFAULT 0,
  ratio               int NOT NULL DEFAULT 0,
  reply_count         int NOT NULL DEFAULT 0,
  share_count         int NOT NULL DEFAULT 0,
  -- moderation
  moderation_score    real,
  moderation_reason   text,
  moderation_reviewed boolean NOT NULL DEFAULT false,
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  -- audit
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX moans_user_idx ON moans (user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX moans_team_idx ON moans (team_id, created_at DESC) WHERE deleted_at IS NULL AND status = 'PUBLISHED';
CREATE INDEX moans_parent_idx ON moans (parent_moan_id) WHERE parent_moan_id IS NOT NULL;
CREATE INDEX moans_status_idx ON moans (status) WHERE status != 'PUBLISHED';
CREATE INDEX moans_feed_idx ON moans (created_at DESC) WHERE deleted_at IS NULL AND status = 'PUBLISHED';
CREATE INDEX moans_text_trgm ON moans USING gin (text gin_trgm_ops);
CREATE TRIGGER moans_updated BEFORE UPDATE ON moans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── reactions ──────────────────────────────────────────────────────────────
CREATE TYPE reaction_kind AS ENUM ('laughs', 'agrees', 'cope', 'ratio');

CREATE TABLE reactions (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id),
  moan_id     uuid NOT NULL REFERENCES moans(id) ON DELETE CASCADE,
  kind        reaction_kind NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, moan_id)
);
CREATE INDEX reactions_moan_idx ON reactions (moan_id);

-- Keep denormalised counts on moans in sync.
CREATE OR REPLACE FUNCTION sync_moan_reaction_counts() RETURNS trigger AS $$
DECLARE
  delta int;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := 1;
    EXECUTE format('UPDATE moans SET %I = %I + $1 WHERE id = $2', NEW.kind, NEW.kind) USING delta, NEW.moan_id;
  ELSIF TG_OP = 'DELETE' THEN
    delta := -1;
    EXECUTE format('UPDATE moans SET %I = %I + $1 WHERE id = $2', OLD.kind, OLD.kind) USING delta, OLD.moan_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.kind <> NEW.kind THEN
    EXECUTE format('UPDATE moans SET %I = %I - 1 WHERE id = $1', OLD.kind, OLD.kind) USING NEW.moan_id;
    EXECUTE format('UPDATE moans SET %I = %I + 1 WHERE id = $1', NEW.kind, NEW.kind) USING NEW.moan_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER reactions_count_sync
  AFTER INSERT OR UPDATE OR DELETE ON reactions
  FOR EACH ROW EXECUTE FUNCTION sync_moan_reaction_counts();

-- Reply count trigger
CREATE OR REPLACE FUNCTION sync_reply_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.parent_moan_id IS NOT NULL THEN
    UPDATE moans SET reply_count = reply_count + 1 WHERE id = NEW.parent_moan_id;
  ELSIF TG_OP = 'DELETE' AND OLD.parent_moan_id IS NOT NULL THEN
    UPDATE moans SET reply_count = reply_count - 1 WHERE id = OLD.parent_moan_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER moans_reply_count_sync
  AFTER INSERT OR DELETE ON moans
  FOR EACH ROW EXECUTE FUNCTION sync_reply_count();

-- ── tags ───────────────────────────────────────────────────────────────────
CREATE TABLE tags (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug        text UNIQUE NOT NULL,
  display     text NOT NULL,
  use_count   int NOT NULL DEFAULT 0,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tags_use_idx ON tags (use_count DESC);

CREATE TABLE moan_tags (
  moan_id     uuid NOT NULL REFERENCES moans(id) ON DELETE CASCADE,
  tag_id      uuid NOT NULL REFERENCES tags(id),
  PRIMARY KEY (moan_id, tag_id)
);
CREATE INDEX moan_tags_tag_idx ON moan_tags (tag_id);

-- ── reports (moderation) ───────────────────────────────────────────────────
CREATE TABLE reports (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  moan_id         uuid NOT NULL REFERENCES moans(id),
  reporter_id     uuid REFERENCES users(id),
  reason          text NOT NULL,
  resolved        boolean NOT NULL DEFAULT false,
  resolution_note text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz
);
CREATE INDEX reports_moan_idx ON reports (moan_id);
CREATE INDEX reports_unresolved_idx ON reports (created_at DESC) WHERE resolved = false;

-- ── notifications ──────────────────────────────────────────────────────────
CREATE TYPE notification_kind AS ENUM (
  'roasted', 'replied', 'reacted_milestone', 'battle_challenged',
  'battle_won', 'battle_lost', 'match_starting', 'weekly_digest'
);

CREATE TABLE notifications (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id         uuid NOT NULL REFERENCES users(id),
  kind            notification_kind NOT NULL,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at         timestamptz,
  emailed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

-- ── fixtures (match-day live threads) ──────────────────────────────────────
CREATE TABLE fixtures (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  external_id     text UNIQUE,
  competition     text NOT NULL,
  home_team_id    uuid NOT NULL REFERENCES teams(id),
  away_team_id    uuid NOT NULL REFERENCES teams(id),
  kickoff_at      timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'SCHEDULED',
  home_score      int,
  away_score      int,
  thread_id       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fixtures_kickoff_idx ON fixtures (kickoff_at);
CREATE INDEX fixtures_teams_idx ON fixtures (home_team_id, away_team_id);
CREATE TRIGGER fixtures_updated BEFORE UPDATE ON fixtures FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── live_thread_events ─────────────────────────────────────────────────────
CREATE TABLE live_thread_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  fixture_id      uuid NOT NULL REFERENCES fixtures(id),
  minute          int NOT NULL,
  text            text NOT NULL,
  source          text NOT NULL DEFAULT 'EDITORIAL',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_events_fixture_idx ON live_thread_events (fixture_id, minute);

-- ── battles ────────────────────────────────────────────────────────────────
CREATE TYPE battle_status AS ENUM ('PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED');

CREATE TABLE battles (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  challenger_id   uuid NOT NULL REFERENCES users(id),
  opponent_id     uuid NOT NULL REFERENCES users(id),
  topic           text,
  status          battle_status NOT NULL DEFAULT 'PENDING',
  challenger_votes int NOT NULL DEFAULT 0,
  opponent_votes  int NOT NULL DEFAULT 0,
  winner_id       uuid REFERENCES users(id),
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battles_status_idx ON battles (status, expires_at);
CREATE TRIGGER battles_updated BEFORE UPDATE ON battles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE battle_messages (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  battle_id   uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX battle_messages_battle_idx ON battle_messages (battle_id, created_at);

CREATE TABLE battle_votes (
  battle_id   uuid NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  voted_for   uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (battle_id, user_id)
);

COMMIT;
