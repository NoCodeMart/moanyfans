-- Two more named house accounts so the seeder can vary the voice.
-- Each one stays badged as a HOUSE account in the UI per the spec.

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'TERRACE_TOM', 'house:terrace_tom', 'house+terrace_tom@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'TERRACE_TOM');

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'THE_GAFFER', 'house:the_gaffer', 'house+the_gaffer@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'THE_GAFFER');

INSERT INTO users (handle, external_id, email, is_house_account)
SELECT 'PUNDIT_PETE', 'house:pundit_pete', 'house+pundit_pete@moanyfans.local', true
WHERE NOT EXISTS (SELECT 1 FROM users WHERE handle = 'PUNDIT_PETE');
