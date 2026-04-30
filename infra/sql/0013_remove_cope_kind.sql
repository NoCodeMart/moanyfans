-- Retire the COPE post kind. Existing COPE moans become MOANs.
-- The 'COPE' value stays in the moan_kind enum (Postgres makes value removal painful)
-- but the app no longer produces it.

UPDATE moans SET kind = 'MOAN' WHERE kind = 'COPE';
