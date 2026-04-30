-- Image attachments on moans (single image v1).
-- media_path is a relative path under the API's /media mount, never a full URL —
-- this lets us swap storage backends (local disk → B2/S3) without rewriting rows.

ALTER TABLE moans
  ADD COLUMN IF NOT EXISTS media_path text,
  ADD COLUMN IF NOT EXISTS media_w    integer,
  ADD COLUMN IF NOT EXISTS media_h    integer,
  ADD COLUMN IF NOT EXISTS media_mime text;
