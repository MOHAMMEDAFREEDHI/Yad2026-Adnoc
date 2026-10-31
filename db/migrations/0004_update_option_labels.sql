-- 0004_update_option_labels.sql
-- Update names and descriptions for option 1 and option 2 to match approved Unity screen.
-- Preserves existing answerOptionIds, foreign keys, votes, and event_participations records.

UPDATE answer_options
   SET label = 'Entrepreneur',
       description = 'Start your own factory or company'
 WHERE display_order = 1;

UPDATE answer_options
   SET label = 'Technology innovator',
       description = 'Shape future and digital solutions'
 WHERE display_order = 2;
