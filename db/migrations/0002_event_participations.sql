-- 0002_event_participations.sql
-- Records anonymous visitor participation at the event level to enforce one-vote-per-browser.
-- Hashed server-side with HMAC-SHA256; raw visitor ID is never stored.

CREATE TABLE event_participations (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_id          uuid        NOT NULL,
  visitor_id_hash   text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT event_participations_pkey PRIMARY KEY (id),
  CONSTRAINT event_participations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT event_participations_event_visitor_unique UNIQUE (event_id, visitor_id_hash)
);

CREATE INDEX IF NOT EXISTS event_participations_event_id_idx ON event_participations (event_id);
