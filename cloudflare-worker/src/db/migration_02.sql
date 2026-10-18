-- Migration 02: Admin, Events, and Divisions

-- 1. Add is_admin column to drivers
ALTER TABLE drivers ADD COLUMN is_admin INTEGER DEFAULT 0;

-- 2. Make nanenj@gmail.com an admin
UPDATE drivers SET is_admin = 1 WHERE email = 'nanenj@gmail.com';

-- 3. Events Table
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

-- 4. Divisions Table
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

-- Initial Divisions Seed
INSERT OR IGNORE INTO divisions (id, name, category, tagline, description, sim, specs, track_img)
VALUES 
    ('spec-racing', 'Spec Racing Division', 'Flagship Championship', 'Equal-Car Precision Competition', 'Our premier equal-car championship. Locked identical setups where precision lines, tire management, and pure racecraft crown the champion.', 'iRacing', '["Equal Machinery", "Fixed Setups", "Live Stewarding"]', 'assets/img/circuit-b.svg'),
    ('rookie-cup', 'Rookie Cup', 'Development Series', 'Beginner Friendly Mentorship', 'A supportive on-ramp for newer drivers. Short sprint formats, driving assists allowed, and veteran mentors riding onboard.', 'Assetto Corsa', '["Assists Welcome", "15-Min Sprints", "Mentored"]', 'assets/img/circuit-a.svg'),
    ('endurance-open', 'Endurance & Open', 'Team Competition', 'Multi-Hour Team Showdowns', 'Multi-hour endurance battles, multiclass traffic, and special weekend showcases. Team up with paddock friends to share stints and pit strategy.', 'ACC', '["Driver Swaps", "Pit Strategy", "Team Championship"]', 'assets/img/circuit-c.svg');

-- Initial Events Seed
INSERT OR IGNORE INTO events (id, title, series, track, sim, event_date, session_time, status, notes)
VALUES
    ('evt_1', 'Weekly Practice & Coaching', 'Open Paddock', 'Watkins Glen International', 'iRacing', '2026-10-22', '8:00 PM EST', 'Lobby Open', 'Open voice channels and setup telemetry analysis.'),
    ('evt_2', 'Round 01: Season Opener', 'Spec Racing Division', 'Lime Rock Park (Classic)', 'iRacing', '2026-10-24', '7:30 PM EST', 'Registration Open', 'Fixed setup spec Mazda MX-5 / GR86.'),
    ('evt_3', 'Round 01: Mentored Sprint', 'Rookie Cup', 'Lime Rock Park (Chicane)', 'Assetto Corsa', '2026-10-25', '6:00 PM EST', 'Registration Open', 'Driving assists allowed, coaching in Discord.'),
    ('evt_4', 'Round 02: Twilight Grand Prix', 'Spec Racing Division', 'Road America', 'iRacing', '2026-10-31', '7:30 PM EST', 'Scheduled', '30-minute sprint with pit stop.'),
    ('evt_5', 'Endurance GT3 Showcase', 'Endurance & Open', 'Spa-Francorchamps', 'ACC', '2026-11-07', '3:00 PM EST', 'Scheduled', '2-driver teams, 3-hour endurance.'),
    ('evt_6', 'Multiclass Le Mans Warmup', 'Endurance & Open', 'Circuit de la Sarthe', 'Le Mans Ultimate', '2026-11-14', '4:00 PM EST', 'Scheduled', 'Hypercar and LMP2 multiclass test.');
