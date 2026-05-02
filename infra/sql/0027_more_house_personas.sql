-- Four extra in-match personas so HOT_TAKE_HARRY isn't the only voice
-- dropping goal-takes. The scheduler rotates between them so consecutive
-- goals get distinctly different writing.

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'TACTICAL_TIM', 'house:tactical_tim', 'house+tactical_tim@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'TACTICAL_TIM');

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'NOSTALGIA_NORM', 'house:nostalgia_norm', 'house+nostalgia_norm@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'NOSTALGIA_NORM');

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'DRUNK_DAVE', 'house:drunk_dave', 'house+drunk_dave@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'DRUNK_DAVE');

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'STAT_SHITHOUSE', 'house:stat_shithouse', 'house+stat_shithouse@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'STAT_SHITHOUSE');
