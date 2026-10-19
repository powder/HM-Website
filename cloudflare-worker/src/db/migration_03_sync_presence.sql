-- HMS Data Sync rendezvous: who is online, under what name, and where to connect.
-- No files or feed content are stored here. One row per member key; an iRacing ID can belong to only one key.
CREATE TABLE IF NOT EXISTS sync_presence (
    key TEXT PRIMARY KEY,
    iracing_id INTEGER UNIQUE,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    listed INTEGER NOT NULL DEFAULT 0,
    last_seen INTEGER NOT NULL,
    active_at INTEGER NOT NULL DEFAULT 0,
    ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_presence_listed ON sync_presence(listed, last_seen);
CREATE INDEX IF NOT EXISTS idx_sync_presence_ip ON sync_presence(ip, last_seen);
