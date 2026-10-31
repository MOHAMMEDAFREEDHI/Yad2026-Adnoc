-- 0003_participation_option.sql
-- Records the visitor's chosen answer option in event_participations so returning visitors
-- can retrieve their actual previously submitted vote.

ALTER TABLE event_participations
  ADD COLUMN IF NOT EXISTS answer_option_id uuid REFERENCES answer_options (id);

-- Backfill any existing participation records from the votes table matching timestamps
UPDATE event_participations ep
   SET answer_option_id = v.answer_option_id
  FROM votes v
 WHERE ep.answer_option_id IS NULL
   AND ep.created_at = v.submitted_at;
