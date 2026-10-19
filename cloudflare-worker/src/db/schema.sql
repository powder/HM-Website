-- Her Motorsport D1 Database Schema

CREATE TABLE IF NOT EXISTS drivers (
    id TEXT PRIMARY KEY,
    alias TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    car_number TEXT NOT NULL DEFAULT '42',
    sim TEXT NOT NULL DEFAULT 'iRacing',
    division TEXT NOT NULL DEFAULT 'Spec Racing',
    pronouns TEXT DEFAULT 'she/her',
    discord TEXT DEFAULT '',
    twitch TEXT DEFAULT '',
    telemetry_id TEXT,
    status TEXT DEFAULT 'Active Driver',
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drivers_email ON drivers(email);
CREATE INDEX IF NOT EXISTS idx_drivers_car_number ON drivers(car_number);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    series TEXT NOT NULL,
    track TEXT NOT NULL,
    sim TEXT NOT NULL DEFAULT 'iRacing',
    event_date TEXT NOT NULL,
    session_time TEXT NOT NULL,
    status TEXT DEFAULT 'Scheduled',
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_sim ON events(sim);

CREATE TABLE IF NOT EXISTS divisions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    tagline TEXT NOT NULL,
    description TEXT NOT NULL,
    sim TEXT NOT NULL DEFAULT 'iRacing',
    specs TEXT NOT NULL DEFAULT '[]',
    track_img TEXT DEFAULT 'assets/img/circuit-b.svg',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
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
