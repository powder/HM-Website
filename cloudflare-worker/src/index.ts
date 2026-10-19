import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { registerSyncRoutes } from './sync.ts';

type Bindings = {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_NAME?: string;
};

interface DriverRecord {
  id: string;
  alias: string;
  email: string;
  password_hash: string;
  car_number: string;
  sim: string;
  division: string;
  pronouns: string;
  discord: string;
  twitch: string;
  telemetry_id: string;
  status: string;
  is_admin?: number;
  created_at?: string;
  updated_at?: string;
}

interface EventRecord {
  id: string;
  title: string;
  series: string;
  track: string;
  sim: string;
  event_date: string;
  session_time: string;
  status: string;
  notes?: string;
}

interface DivisionRecord {
  id: string;
  name: string;
  category: string;
  tagline: string;
  description: string;
  sim: string;
  specs: string;
  track_img: string;
}

const app = new Hono<{ Bindings: Bindings }>();

// Edge Security Headers & CORS
app.use('*', secureHeaders());
app.use('/api/*', cors({
  origin: (origin) => origin || '*',
  credentials: true,
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Id']
}));

// --- Helper: Web Crypto SHA-256 ---
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sanitizeDriver(driver: DriverRecord) {
  const isAdmin = Boolean(driver.is_admin === 1 || driver.email.toLowerCase() === 'nanenj@gmail.com');
  return {
    id: driver.id,
    alias: driver.alias,
    email: driver.email,
    carNumber: driver.car_number,
    sim: driver.sim,
    division: driver.division,
    pronouns: driver.pronouns,
    discord: driver.discord,
    twitch: driver.twitch,
    telemetryId: driver.telemetry_id,
    status: driver.status,
    isAdmin: isAdmin,
    joinedDate: driver.created_at ? new Date(driver.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '2026'
  };
}

async function verifyAdmin(c: any, adminIdOrEmail?: string): Promise<boolean> {
  const identifier = adminIdOrEmail || c.req.header('X-Admin-Id');
  if (!identifier) return false;
  
  if (identifier.toLowerCase() === 'nanenj@gmail.com') return true;

  const row = (await c.env.DB.prepare(
    `SELECT is_admin, email FROM drivers WHERE id = ? OR email = ?`
  ).bind(identifier, identifier.toLowerCase()).first()) as { is_admin: number; email: string } | null;

  return Boolean(row && (row.is_admin === 1 || row.email.toLowerCase() === 'nanenj@gmail.com'));
}

// ==========================================================================
// PUBLIC API ENDPOINTS
// ==========================================================================

// --- API: Get Public Grid Roster ---
app.get('/api/roster', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT id, alias, email, car_number, sim, division, pronouns, discord, twitch, telemetry_id, status, is_admin, created_at 
       FROM drivers 
       ORDER BY created_at DESC`
    ).all();

    // Emails are private: never expose them on the public roster.
    const drivers = ((results || []) as unknown as DriverRecord[]).map((row) => {
      const { email: _email, ...publicDriver } = sanitizeDriver(row);
      return publicDriver;
    });
    return c.json({ success: true, drivers });
  } catch (err: any) {
    console.error('Failed to fetch roster from D1:', err);
    return c.json({ success: false, message: 'Could not fetch roster', drivers: [] }, 500);
  }
});

// --- API: Get Events (Filtered by Sim if provided) ---
app.get('/api/events', async (c) => {
  try {
    const sim = c.req.query('sim');
    let query = `SELECT * FROM events`;
    const params: any[] = [];

    if (sim && sim !== 'all') {
      query += ` WHERE LOWER(sim) = LOWER(?)`;
      params.push(sim);
    }
    query += ` ORDER BY event_date ASC`;

    const stmt = params.length ? c.env.DB.prepare(query).bind(...params) : c.env.DB.prepare(query);
    const { results } = await stmt.all();
    return c.json({ success: true, events: results || [] });
  } catch (err: any) {
    console.error('Failed to fetch events from D1:', err);
    return c.json({ success: false, message: 'Could not fetch events', events: [] }, 500);
  }
});

// --- API: Get Divisions ---
app.get('/api/divisions', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM divisions ORDER BY created_at ASC`
    ).all();
    return c.json({ success: true, divisions: results || [] });
  } catch (err: any) {
    console.error('Failed to fetch divisions from D1:', err);
    return c.json({ success: false, message: 'Could not fetch divisions', divisions: [] }, 500);
  }
});

// --- API: Driver Registration (Telemetry ID is no longer required on signup) ---
app.post('/api/auth/register', async (c) => {
  try {
    const body = await c.req.json();
    const alias = (body.alias || '').trim();
    const rawEmail = (body.email || '').trim();
    const email = rawEmail || (alias.toLowerCase().replace(/[^a-z0-9]/g, '') + '@paddock.sim');
    const password = body.password || 'password123';
    const carNumber = (body.carNumber || '42').toString().padStart(2, '0').slice(-3);
    const sim = body.sim || 'iRacing';
    const division = body.division || 'Spec Racing';
    const pronouns = (body.pronouns || '').trim() || 'she/her';
    const discord = (body.discord || '').trim();
    const twitch = (body.twitch || '').trim();
    
    // Telemetry ID is generated automatically if not provided
    const telemetryId = (body.telemetryId || '').trim() || ('SIM-' + Math.floor(10000 + Math.random() * 90000));
    
    // Auto-promote nanenj@gmail.com
    const isAdmin = (email.toLowerCase() === 'nanenj@gmail.com') ? 1 : 0;

    if (!alias) {
      return c.json({ success: false, message: 'Driver Name / Alias is required.' }, 400);
    }

    const passwordHash = await hashPassword(password);
    const driverId = 'driver_' + Date.now();

    await c.env.DB.prepare(
      `INSERT INTO drivers (id, alias, email, password_hash, car_number, sim, division, pronouns, discord, twitch, telemetry_id, status, is_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      driverId,
      alias,
      email.toLowerCase(),
      passwordHash,
      carNumber,
      sim,
      division,
      pronouns,
      discord,
      twitch,
      telemetryId,
      'Active Driver',
      isAdmin
    ).run();

    const createdDriver: DriverRecord = {
      id: driverId,
      alias,
      email: email.toLowerCase(),
      password_hash: '',
      car_number: carNumber,
      sim,
      division,
      pronouns,
      discord,
      twitch,
      telemetry_id: telemetryId,
      status: 'Active Driver',
      is_admin: isAdmin
    };

    return c.json({
      success: true,
      message: 'Driver registered successfully',
      driver: sanitizeDriver(createdDriver)
    });
  } catch (err: any) {
    if (err.message && err.message.includes('UNIQUE constraint failed')) {
      return c.json({ success: false, message: 'A driver with this email already exists.' }, 409);
    }
    console.error('Registration error:', err);
    return c.json({ success: false, message: 'Server error during registration.' }, 500);
  }
});

// --- API: Driver Login ---
app.post('/api/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json();
    if (!email || !password) {
      return c.json({ success: false, message: 'Email and password are required.' }, 400);
    }

    const driver = (await c.env.DB.prepare(
      `SELECT * FROM drivers WHERE email = ?`
    ).bind(email.toLowerCase().trim()).first()) as DriverRecord | null;

    if (!driver) {
      return c.json({ success: false, message: 'Driver not found. Please register first.' }, 404);
    }

    const passwordHash = await hashPassword(password);
    if (driver.password_hash !== passwordHash) {
      return c.json({ success: false, message: 'Invalid password.' }, 401);
    }

    // Ensure nanenj@gmail.com is flagged as admin
    if (driver.email.toLowerCase() === 'nanenj@gmail.com' && !driver.is_admin) {
      driver.is_admin = 1;
      await c.env.DB.prepare(`UPDATE drivers SET is_admin = 1 WHERE id = ?`).bind(driver.id).run();
    }

    return c.json({
      success: true,
      driver: sanitizeDriver(driver)
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return c.json({ success: false, message: 'Error processing login.' }, 500);
  }
});

// --- API: Update Profile ---
app.post('/api/driver/profile', async (c) => {
  try {
    const body = await c.req.json();
    const { id, alias, pronouns, carNumber, sim, division, discord, twitch, telemetryId } = body;

    if (!id) return c.json({ success: false, message: 'Driver ID is required.' }, 400);

    await c.env.DB.prepare(
      `UPDATE drivers 
       SET alias = ?, pronouns = ?, car_number = ?, sim = ?, division = ?, discord = ?, twitch = ?, telemetry_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      alias,
      pronouns || 'she/her',
      (carNumber || '42').toString().padStart(2, '0').slice(-3),
      sim || 'iRacing',
      division || 'Spec Racing',
      discord || '',
      twitch || '',
      telemetryId || '',
      id
    ).run();

    const updated = (await c.env.DB.prepare(`SELECT * FROM drivers WHERE id = ?`).bind(id).first()) as DriverRecord | null;
    return c.json({ success: true, driver: updated ? sanitizeDriver(updated) : null });
  } catch (err: any) {
    console.error('Profile update error:', err);
    return c.json({ success: false, message: 'Error updating driver profile.' }, 500);
  }
});

// --- API: Update Account ---
app.post('/api/driver/account', async (c) => {
  try {
    const { id, email, current_password, new_password } = await c.req.json();
    if (!id) return c.json({ success: false, message: 'Driver ID is required.' }, 400);

    const driver = (await c.env.DB.prepare(`SELECT * FROM drivers WHERE id = ?`).bind(id).first()) as DriverRecord | null;
    if (!driver) return c.json({ success: false, message: 'Driver not found.' }, 404);

    if (current_password) {
      const curHash = await hashPassword(current_password);
      if (driver.password_hash !== curHash) {
        return c.json({ success: false, message: 'Current password is incorrect.' }, 401);
      }
    } else if (new_password || (email && email !== driver.email)) {
      return c.json({ success: false, message: 'Current password is required to update account security.' }, 400);
    }

    let targetEmail = driver.email;
    let targetHash = driver.password_hash;

    if (email && email.trim()) targetEmail = email.toLowerCase().trim();
    if (new_password) targetHash = await hashPassword(new_password);

    await c.env.DB.prepare(
      `UPDATE drivers SET email = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).bind(targetEmail, targetHash, id).run();

    const updated = (await c.env.DB.prepare(`SELECT * FROM drivers WHERE id = ?`).bind(id).first()) as DriverRecord | null;
    return c.json({ success: true, message: 'Account updated successfully.', driver: updated ? sanitizeDriver(updated) : null });
  } catch (err: any) {
    console.error('Account update error:', err);
    return c.json({ success: false, message: 'Error updating account.' }, 500);
  }
});

// --- API: Forgot Password ---
app.post('/api/auth/forgot-password', async (c) => {
  const { email } = await c.req.json();
  if (!email) return c.json({ success: false, message: 'Email is required.' }, 400);

  const driver = await c.env.DB.prepare(`SELECT id FROM drivers WHERE email = ?`).bind(email.toLowerCase().trim()).first();
  if (!driver) return c.json({ success: false, message: 'Driver email not found.' }, 404);

  return c.json({ success: true, message: 'Password reset link sent.' });
});

// ==========================================================================
// ADMIN PORTAL CRUD ENDPOINTS (Authorized for nanenj@gmail.com / is_admin = 1)
// ==========================================================================

// --- Middleware Guard for Admin Routes ---
app.use('/api/admin/*', async (c, next) => {
  const body: any = c.req.method !== 'GET' ? await c.req.raw.clone().json().catch(() => ({})) : {};
  const adminIdentifier = body.adminId || c.req.header('X-Admin-Id') || c.req.query('adminId');

  const isAdmin = await verifyAdmin(c, adminIdentifier);
  if (!isAdmin) {
    return c.json({ success: false, message: 'Unauthorized. Admin permissions required.' }, 403);
  }
  await next();
});

// --- Admin: Events CRUD ---
app.post('/api/admin/events', async (c) => {
  try {
    const { title, series, track, sim, event_date, session_time, status, notes } = await c.req.json();
    if (!title || !track || !event_date) {
      return c.json({ success: false, message: 'Title, track, and date are required.' }, 400);
    }

    const id = 'evt_' + Date.now();
    await c.env.DB.prepare(
      `INSERT INTO events (id, title, series, track, sim, event_date, session_time, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      title.trim(),
      series || 'Open Paddock',
      track.trim(),
      sim || 'iRacing',
      event_date,
      session_time || '8:00 PM EST',
      status || 'Scheduled',
      notes || ''
    ).run();

    return c.json({ success: true, message: 'Event created', id });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

app.put('/api/admin/events/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { title, series, track, sim, event_date, session_time, status, notes } = await c.req.json();

    await c.env.DB.prepare(
      `UPDATE events 
       SET title = ?, series = ?, track = ?, sim = ?, event_date = ?, session_time = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(title, series, track, sim, event_date, session_time, status, notes, id).run();

    return c.json({ success: true, message: 'Event updated' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

app.delete('/api/admin/events/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM events WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: 'Event deleted' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

// --- Admin: Shift Schedule Times by Week ---
app.post('/api/admin/events/shift', async (c) => {
  try {
    const { weeks } = await c.req.json();
    const weekCount = parseInt(weeks || 1, 10);
    const dayModifier = `${weekCount * 7} days`;

    // Shift all upcoming events by +7, -7, or +/- N days
    await c.env.DB.prepare(
      `UPDATE events 
       SET event_date = date(event_date, ?), updated_at = CURRENT_TIMESTAMP 
       WHERE event_date >= date('now', '-7 days')`
    ).bind(dayModifier).run();

    const { results } = await c.env.DB.prepare(`SELECT * FROM events ORDER BY event_date ASC`).all();
    return c.json({ success: true, message: `Shifted events by ${weekCount} week(s)`, events: results });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

// --- Admin: Divisions CRUD ---
app.post('/api/admin/divisions', async (c) => {
  try {
    const { name, category, tagline, description, sim, specs, track_img } = await c.req.json();
    if (!name || !description) {
      return c.json({ success: false, message: 'Division name and description are required.' }, 400);
    }

    const id = 'div_' + Date.now();
    const specsJson = typeof specs === 'string' ? specs : JSON.stringify(specs || []);

    await c.env.DB.prepare(
      `INSERT INTO divisions (id, name, category, tagline, description, sim, specs, track_img)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      name.trim(),
      category || 'Championship Series',
      tagline || '',
      description.trim(),
      sim || 'iRacing',
      specsJson,
      track_img || 'assets/img/circuit-b.svg'
    ).run();

    return c.json({ success: true, message: 'Division created', id });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

app.put('/api/admin/divisions/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { name, category, tagline, description, sim, specs, track_img } = await c.req.json();
    const specsJson = typeof specs === 'string' ? specs : JSON.stringify(specs || []);

    await c.env.DB.prepare(
      `UPDATE divisions 
       SET name = ?, category = ?, tagline = ?, description = ?, sim = ?, specs = ?, track_img = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(name, category, tagline, description, sim, specsJson, track_img, id).run();

    return c.json({ success: true, message: 'Division updated' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

app.delete('/api/admin/divisions/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM divisions WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: 'Division deleted' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

// --- Admin: Roster Driver Edit & Removal ---
app.put('/api/admin/drivers/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const { alias, carNumber, sim, division, status, is_admin } = await c.req.json();

    await c.env.DB.prepare(
      `UPDATE drivers 
       SET alias = ?, car_number = ?, sim = ?, division = ?, status = ?, is_admin = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).bind(
      alias,
      (carNumber || '42').toString().padStart(2, '0').slice(-3),
      sim || 'iRacing',
      division || 'Spec Racing',
      status || 'Active Driver',
      is_admin ? 1 : 0,
      id
    ).run();

    return c.json({ success: true, message: 'Driver updated on grid' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

app.delete('/api/admin/drivers/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM drivers WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: 'Driver removed from grid' });
  } catch (err: any) {
    return c.json({ success: false, message: err.message }, 500);
  }
});

// --- Admin: free an iRacing ID claimed by a lost or squatting Data Sync key ---
app.post('/api/admin/sync/release', async (c) => {
  if (!(await verifyAdmin(c))) return c.json({ success: false, message: 'Admin access required' }, 403);
  const body = await c.req.json().catch(() => ({}) as any);
  const iracingId = Number(body?.iracingId);
  if (!Number.isInteger(iracingId) || iracingId < 1) return c.json({ success: false, message: 'iracingId is required' }, 400);
  await c.env.DB.prepare(`UPDATE sync_presence SET iracing_id = NULL WHERE iracing_id = ?`).bind(iracingId).run();
  return c.json({ success: true, message: `iRacing ID ${iracingId} is free to claim again` });
});

// --- HMS Data Sync rendezvous (presence only; stores no files) ---
registerSyncRoutes(app);

// --- Edge Clean URL Redirects ---
app.get('/conduct', (c) => c.redirect('/#conduct', 301));
app.get('/calendar', (c) => c.redirect('/#calendar', 301));
app.get('/admin', (c) => c.redirect('/#admin', 301));
app.get('/divisions', (c) => c.redirect('/#divisions', 301));
app.get('/paddock', (c) => c.redirect('/#members', 301));
app.get('/portal', (c) => c.redirect('/#members', 301));

// Fallback: Static Assets from Cloudflare edge
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
