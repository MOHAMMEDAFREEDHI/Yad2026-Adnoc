-- 0001_baseline.sql
-- Reproduces the schema that already exists in AWS RDS (created manually via pgAdmin).
-- DO NOT run against the existing database. Adopt it instead:  npm run db:baseline
-- A fresh environment runs it normally:                         npm run db:migrate
--
-- Source of truth: rds-columns, rds-constraints, and pg_constraint CHECK inspection outputs.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid() (built in on PG13+)

CREATE TABLE events (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  slug        text        NOT NULL,
  status      text        NOT NULL DEFAULT 'draft',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_pkey PRIMARY KEY (id),
  CONSTRAINT events_slug_key UNIQUE (slug),
  CONSTRAINT events_status_check CHECK (status IN ('draft', 'open', 'closed'))
);

CREATE TABLE questions (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  event_id      uuid        NOT NULL,
  prompt        text        NOT NULL,
  subtitle      text,
  display_order integer     NOT NULL DEFAULT 1,
  status        text        NOT NULL DEFAULT 'draft',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT questions_pkey PRIMARY KEY (id),
  CONSTRAINT questions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events (id),
  CONSTRAINT questions_event_order_unique UNIQUE (event_id, display_order),
  CONSTRAINT questions_id_event_unique UNIQUE (id, event_id),
  CONSTRAINT questions_display_order_check CHECK (display_order > 0),
  CONSTRAINT questions_prompt_check CHECK (length(btrim(prompt)) > 0),
  CONSTRAINT questions_status_check CHECK (status IN ('draft', 'active', 'closed'))
);

CREATE TABLE answer_options (
  id            uuid        NOT NULL DEFAULT gen_random_uuid(),
  question_id   uuid        NOT NULL,
  label         text        NOT NULL,
  description   text,
  image_url     text,
  icon_key      text,
  display_order integer     NOT NULL DEFAULT 1,
  is_active     boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT answer_options_pkey PRIMARY KEY (id),
  CONSTRAINT answer_options_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions (id),
  CONSTRAINT answer_options_question_id_unique UNIQUE (id, question_id),
  CONSTRAINT answer_options_question_order_unique UNIQUE (question_id, display_order),
  CONSTRAINT answer_options_display_order_check CHECK (display_order > 0),
  CONSTRAINT answer_options_label_check CHECK (length(btrim(label)) > 0)
);

CREATE TABLE votes (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  question_id      uuid        NOT NULL,
  answer_option_id uuid        NOT NULL,
  idempotency_key  uuid        NOT NULL,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT votes_pkey PRIMARY KEY (id),
  CONSTRAINT votes_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT votes_question_id_fkey FOREIGN KEY (question_id) REFERENCES questions (id),
  -- selected answer must belong to the submitted question
  CONSTRAINT votes_answer_matches_question FOREIGN KEY (answer_option_id, question_id)
    REFERENCES answer_options (id, question_id)
);
