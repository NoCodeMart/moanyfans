-- One report per (reporter, moan). DB-level guarantee on top of the
-- application-level dedupe in routers/moans.py::report_moan.
-- Drop dupes first if any slipped in.
DELETE FROM reports a USING reports b
 WHERE a.id < b.id
   AND a.moan_id = b.moan_id
   AND a.reporter_id = b.reporter_id;

CREATE UNIQUE INDEX IF NOT EXISTS reports_reporter_moan_uidx
  ON reports (reporter_id, moan_id);

-- Belt-and-braces: the GUEST_TESTER account must never be admin while
-- auth_enabled=false (every visitor would inherit the grant).
UPDATE users SET is_admin = false WHERE handle = 'GUEST_TESTER';
