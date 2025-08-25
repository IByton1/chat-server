CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,     -- Geräte-ID (UUID)
  name         TEXT,
  groupName    TEXT,
  allowedUntil INTEGER NOT NULL,
  blocked      INTEGER NOT NULL DEFAULT 0,
  activatedAt  INTEGER NOT NULL,
  lastCheckIn  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  name   TEXT PRIMARY KEY,
  locked INTEGER NOT NULL DEFAULT 0,
  allowedUntil INTEGER DEFAULT 0
);