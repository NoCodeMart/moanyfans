-- 0009: align Premier League / Championship to the 2025-26 season.
--   Promoted: Leeds, Burnley, Sunderland   (Champ → PL)
--   Relegated: Ipswich, Leicester, Southampton (PL → Champ)
-- Lower divisions left for a separate pass.

BEGIN;

UPDATE teams SET league = 'Premier League'
 WHERE slug IN ('leeds', 'burnley', 'sunderland');

UPDATE teams SET league = 'Championship'
 WHERE slug IN ('ipswich', 'leicester', 'southampton');

COMMIT;
