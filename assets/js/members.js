/**
 * Her Motorsport — Cloudflare Worker Edge & Member Management
 *
 * Integrates directly with Cloudflare Worker D1 Edge Database API (/api/*)
 * with automatic fallback to local session cache for smooth offline development.
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'hm_driver_session';
  var DB_KEY = 'hm_registered_drivers';
  var memoryStorage = {};

  // Safe storage wrapper
  function safeGet(key) {
    try {
      var val = localStorage.getItem(key);
      if (val) return val;
    } catch (e) {}
    return memoryStorage[key] || null;
  }

  function safeSet(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
    memoryStorage[key] = val;
  }

  function safeRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (e) {}
    delete memoryStorage[key];
  }

  function saveDriverToDB(profile) {
    if (!profile || !profile.email) return;
    try {
      var db = JSON.parse(safeGet(DB_KEY) || '{}');
      db[profile.email.toLowerCase()] = profile;
      safeSet(DB_KEY, JSON.stringify(db));
    } catch (e) {}
  }

  function getDriverByEmail(email) {
    if (!email) return null;
    try {
      var db = JSON.parse(safeGet(DB_KEY) || '{}');
      return db[email.toLowerCase()] || null;
    } catch (e) {
      return null;
    }
  }

  // Current session
  var currentDriver = getSavedDriver();

  function getSavedDriver() {
    try {
      var raw = safeGet(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveDriver(driver) {
    currentDriver = driver;
    if (driver) {
      safeSet(STORAGE_KEY, JSON.stringify(driver));
    } else {
      safeRemove(STORAGE_KEY);
    }
    updateUI();
  }

  function isCurrentDriverAdmin() {
    if (!currentDriver) return false;
    if (currentDriver.email && currentDriver.email.toLowerCase() === 'nanenj@gmail.com') return true;
    if (currentDriver.isAdmin || currentDriver.is_admin === 1) return true;
    return false;
  }

  // --- Edge API Handlers ---

  async function registerDriver(data) {
    var alias = (data.alias || '').trim() || 'Paddock Driver';
    var email = (data.email || '').trim() || (alias.toLowerCase().replace(/[^a-z0-9]/g, '') + '@paddock.sim');
    var password = data.password || 'password123';
    var carNumber = (data.carNumber || '42').toString().padStart(2, '0').slice(-3);
    var sim = data.sim || 'iRacing';
    var division = data.division || 'Spec Racing';
    var pronouns = (data.pronouns || '').trim() || 'she/her';
    var discord = (data.discord || '').trim();
    var twitch = (data.twitch || '').trim();
    var telemetryId = (data.telemetryId || '').trim() || ('SIM-' + Math.floor(10000 + Math.random() * 90000));

    var payload = {
      alias: alias,
      email: email,
      password: password,
      carNumber: carNumber,
      sim: sim,
      division: division,
      pronouns: pronouns,
      discord: discord,
      twitch: twitch,
      telemetryId: telemetryId
    };

    try {
      var res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = await res.json();
      if (!result.success) throw new Error(result.message || 'Registration failed.');

      var profile = result.driver;
      saveDriverToDB(profile);
      fetchRoster(); // refresh global roster from edge
      return profile;
    } catch (err) {
      // Local fallback if API is unreachable (e.g. static preview)
      if (err.message && err.message.includes('already exists')) {
        throw err;
      }
      var fallbackProfile = {
        id: 'driver_' + Date.now(),
        alias: alias,
        email: email,
        password: password,
        carNumber: carNumber,
        sim: sim,
        division: division,
        pronouns: pronouns,
        discord: discord,
        twitch: twitch,
        telemetryId: telemetryId,
        status: 'Active Driver',
        joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      };
      saveDriverToDB(fallbackProfile);
      renderLocalRoster();
      return fallbackProfile;
    }
  }

  async function loginDriver(email, password) {
    email = (email || '').trim();
    if (!email) throw new Error('Please enter your email.');

    try {
      var res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, password: password })
      });
      var result = await res.json();
      if (!result.success) throw new Error(result.message || 'Invalid login details.');

      saveDriver(result.driver);
      return result.driver;
    } catch (err) {
      // Fallback to local DB if API offline
      var existing = getDriverByEmail(email);
      if (existing) {
        if (existing.password && existing.password !== password) {
          throw new Error('Invalid login details.');
        }
        saveDriver(existing);
        return existing;
      }
      throw err;
    }
  }

  async function loginWithDiscord() {
    var handle = prompt('Connect with Discord:\nEnter your Discord username:', 'SpeedQueen#1234');
    if (!handle) handle = 'Driver' + Math.floor(100 + Math.random() * 900);
    var cleanName = handle.replace(/[^a-zA-Z0-9]/g, '');

    var discordProfile = {
      alias: handle,
      email: (cleanName || 'driver').toLowerCase() + '@discord.sim',
      password: 'discord-auth-token',
      carNumber: String(Math.floor(1 + Math.random() * 99)).padStart(2, '0'),
      sim: 'iRacing',
      division: 'Spec Racing',
      pronouns: 'she/they',
      discord: handle,
      twitch: '',
      telemetryId: 'DISC-' + Math.floor(1000 + Math.random() * 9000)
    };

    try {
      var reg = await registerDriver(discordProfile);
      saveDriver(reg);
    } catch (e) {
      saveDriverToDB(discordProfile);
      saveDriver(discordProfile);
    }
  }

  async function sendPasswordReset(email) {
    if (!email) throw new Error("Please enter your email.");
    try {
      var res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email })
      });
      var result = await res.json();
      if (!result.success) throw new Error(result.message || 'Error processing request.');
      return true;
    } catch (err) {
      var existing = getDriverByEmail(email);
      if (!existing) throw new Error("Email not found.");
      return true;
    }
  }

  async function updatePassword(newPassword) {
    if (!newPassword) throw new Error("Please enter a new password.");
    if (!currentDriver) throw new Error("Must be logged in to update password.");

    return updateAccount({ new_password: newPassword });
  }

  async function updateProfile(data) {
    if (!currentDriver) throw new Error("Not logged in");

    try {
      var payload = Object.assign({ id: currentDriver.id }, data);
      var res = await fetch('/api/driver/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = await res.json();
      if (result.success && result.driver) {
        saveDriver(result.driver);
        fetchRoster();
        return;
      }
    } catch (e) {
      console.warn('API update failed, updating locally:', e);
    }

    Object.assign(currentDriver, data);
    saveDriverToDB(currentDriver);
    saveDriver(currentDriver);
    renderLocalRoster();
  }

  async function updateAccount(data) {
    if (!currentDriver) throw new Error("Not logged in");

    try {
      var payload = Object.assign({ id: currentDriver.id }, data);
      var res = await fetch('/api/driver/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      var result = await res.json();
      if (!result.success) throw new Error(result.message || 'Error updating account.');
      if (result.driver) {
        saveDriver(result.driver);
      }
      return;
    } catch (e) {
      if (e.message && e.message.includes('password')) throw e;
      console.warn('API account update failed, falling back locally:', e);
    }

    if (data.email) currentDriver.email = data.email;
    if (data.new_password) currentDriver.password = data.new_password;
    saveDriverToDB(currentDriver);
    saveDriver(currentDriver);
  }

  function logoutDriver() {
    saveDriver(null);
  }

  // --- Global Grid Roster Fetching ---

  async function fetchRoster() {
    try {
      var res = await fetch('/api/roster');
      var data = await res.json();
      if (data.success && Array.isArray(data.drivers)) {
        renderRoster(data.drivers);
        return;
      }
    } catch (e) {
      // Fallback to local
    }
    renderLocalRoster();
  }

  function renderLocalRoster() {
    var db = {};
    try {
      db = JSON.parse(safeGet(DB_KEY) || '{}');
    } catch (e) {}
    var drivers = Object.values(db);
    renderRoster(drivers);
  }

  function renderRoster(drivers) {
    var tbody = document.getElementById('roster-tbody');
    if (!tbody) return;

    if (!drivers || drivers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="roster-empty">No drivers registered yet. Register your Paddock Pass above to claim the #1 grid spot!</td></tr>';
      return;
    }

    var html = '';
    drivers.forEach(function (d, idx) {
      var pos = 'P' + (idx + 1);
      var twitchHtml = d.twitch ? '<a class="twitch-link" href="https://twitch.tv/' + escapeHTML(d.twitch.replace('@', '')) + '" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/></svg>' + escapeHTML(d.twitch) + '</a>' : '<span style="color: var(--text-subtle);">—</span>';
      
      html += '<tr>' +
        '<td class="roster-pos"><span class="pos-badge">' + pos + '</span></td>' +
        '<td class="roster-driver"><strong class="driver-name">' + escapeHTML(d.alias) + '</strong>' + (d.pronouns ? ' <span class="roster-pronouns">' + escapeHTML(d.pronouns) + '</span>' : '') + '</td>' +
        '<td class="roster-number"><span class="driver-num-plate">#' + escapeHTML(d.carNumber || '00') + '</span></td>' +
        '<td class="roster-division"><span class="div-pill">' + escapeHTML(d.division || 'Spec Racing') + '</span></td>' +
        '<td class="roster-sim"><span class="sim-badge">' + escapeHTML(d.sim || 'iRacing') + '</span></td>' +
        '<td class="roster-twitch">' + twitchHtml + '</td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  // --- Events, Calendar & Simulator Filtering ---

  var currentEvents = [];
  var currentSimFilter = 'all';

  function formatEventDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  async function fetchEvents(sim) {
    if (sim !== undefined) currentSimFilter = sim;
    try {
      var url = '/api/events' + (currentSimFilter && currentSimFilter !== 'all' ? '?sim=' + encodeURIComponent(currentSimFilter) : '');
      var res = await fetch(url);
      var data = await res.json();
      if (data.success && Array.isArray(data.events)) {
        currentEvents = data.events;
        renderScheduleTable(currentEvents);
        renderCalendarGrid(currentEvents);
        return;
      }
    } catch (e) {
      console.warn('Could not fetch events from edge API, using defaults:', e);
    }
  }

  function renderScheduleTable(events) {
    var tbody = document.getElementById('schedule-tbody');
    if (!tbody) return;
    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">No upcoming race sessions scheduled for this simulator.</td></tr>';
      return;
    }
    var html = '';
    events.forEach(function (ev) {
      var statusColor = ev.status === 'Lobby Open' 
        ? 'color: var(--telemetry-green); border-color: rgba(46, 204, 113, 0.4);' 
        : (ev.status === 'Completed' ? 'opacity: 0.5;' : '');
      
      html += '<tr>' +
        '<td><strong>' + escapeHTML(ev.title) + '</strong>' + (ev.notes ? '<br><small style="color:var(--text-subtle);">' + escapeHTML(ev.notes) + '</small>' : '') + '</td>' +
        '<td>' + escapeHTML(ev.series || 'Open Paddock') + '</td>' +
        '<td>' + escapeHTML(ev.track) + '</td>' +
        '<td><span class="sim-badge">' + escapeHTML(ev.sim || 'iRacing') + '</span></td>' +
        '<td>' + escapeHTML(formatEventDate(ev.event_date)) + ' &bull; ' + escapeHTML(ev.session_time || '') + '</td>' +
        '<td><span class="spec-pill" style="' + statusColor + '">' + escapeHTML(ev.status || 'Scheduled') + '</span></td>' +
      '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderCalendarGrid(events) {
    var grid = document.getElementById('calendar-cards-grid');
    if (!grid) return;
    if (!events || events.length === 0) {
      grid.innerHTML = '<div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">No upcoming races found matching the selected simulator.</div>';
      return;
    }
    var html = '';
    events.forEach(function (ev) {
      var dateFormatted = formatEventDate(ev.event_date);
      var statusColor = ev.status === 'Lobby Open' 
        ? 'color: var(--telemetry-green); border-color: rgba(46, 204, 113, 0.4);' 
        : (ev.status === 'Completed' ? 'opacity: 0.5;' : '');

      html += '<article class="calendar-card">' +
        '<div class="calendar-card-date">' +
          '<span class="date-badge">' + escapeHTML(dateFormatted) + '</span>' +
          '<span class="time-label">' + escapeHTML(ev.session_time || '8:00 PM EST') + '</span>' +
        '</div>' +
        '<h3>' + escapeHTML(ev.title) + '</h3>' +
        '<div class="calendar-track-info">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><polygon points="12 6 12 12 16 14"></polygon></svg>' +
          '<span>' + escapeHTML(ev.track) + '</span>' +
        '</div>' +
        (ev.notes ? '<p style="font-size: 0.9rem; color: var(--text-muted); margin: 0.25rem 0;">' + escapeHTML(ev.notes) + '</p>' : '') +
        '<div class="calendar-meta-row">' +
          '<span class="spec-pill">' + escapeHTML(ev.series || 'Spec Racing') + '</span>' +
          '<span class="sim-badge">' + escapeHTML(ev.sim || 'iRacing') + '</span>' +
          '<span class="spec-pill" style="' + statusColor + '">' + escapeHTML(ev.status || 'Scheduled') + '</span>' +
        '</div>' +
      '</article>';
    });
    grid.innerHTML = html;
  }

  // --- Divisions Fetching & Rendering ---

  var currentDivisions = [];

  async function fetchDivisions() {
    try {
      var res = await fetch('/api/divisions');
      var data = await res.json();
      if (data.success && Array.isArray(data.divisions)) {
        currentDivisions = data.divisions;
        renderDivisionsGrid(currentDivisions);
        return;
      }
    } catch (e) {
      console.warn('Could not fetch divisions from edge API:', e);
    }
  }

  function renderDivisionsGrid(divisions) {
    var grid = document.getElementById('divisions-cards-grid');
    if (!grid) return;
    if (!divisions || divisions.length === 0) return;
    var html = '';
    divisions.forEach(function (div) {
      var specs = [];
      try {
        specs = typeof div.specs === 'string' ? JSON.parse(div.specs) : (div.specs || []);
      } catch (e) {
        specs = (div.specs || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      }
      var specsHtml = specs.map(function (sp) {
        return '<span class="spec-pill">' + escapeHTML(sp) + '</span>';
      }).join(' ');

      html += '<article class="series-card">' +
        '<div class="series-track-banner">' +
          '<img src="' + escapeHTML(div.track_img || 'assets/img/circuit-b.svg') + '" alt="Track map" width="320" height="180">' +
        '</div>' +
        '<div class="series-card-body">' +
          '<span class="series-badge">' + escapeHTML(div.category || 'Championship Series') + '</span>' +
          '<h3>' + escapeHTML(div.name) + '</h3>' +
          (div.tagline ? '<p style="color: var(--hm-purple-bright); font-size: 0.88rem; font-weight: 600; margin: -0.25rem 0 0.5rem;">' + escapeHTML(div.tagline) + '</p>' : '') +
          '<p style="color: var(--text-muted); font-size: 0.95rem;">' + escapeHTML(div.description) + '</p>' +
          '<div class="series-specs" style="margin-top: 1rem;">' +
            '<span class="sim-badge">' + escapeHTML(div.sim || 'iRacing') + '</span>' +
            specsHtml +
          '</div>' +
        '</div>' +
      '</article>';
    });
    grid.innerHTML = html;
  }

  // --- Admin Race Control Operations ---

  function getAdminAuthHeader() {
    return (currentDriver && currentDriver.id) || 'nanenj@gmail.com';
  }

  async function loadAdminEvents() {
    var tbody = document.getElementById('admin-events-tbody');
    if (!tbody) return;
    try {
      var res = await fetch('/api/events?sim=all');
      var data = await res.json();
      if (!data.success || !Array.isArray(data.events)) return;
      var events = data.events;
      if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No events found. Click "+ Create New Event" above to schedule one.</td></tr>';
        return;
      }
      var html = '';
      events.forEach(function (ev) {
        html += '<tr data-event-id="' + escapeHTML(ev.id) + '">' +
          '<td><strong>' + escapeHTML(ev.title) + '</strong></td>' +
          '<td>' + escapeHTML(ev.series || '') + '</td>' +
          '<td>' + escapeHTML(ev.track) + '</td>' +
          '<td><span class="sim-badge">' + escapeHTML(ev.sim || 'iRacing') + '</span></td>' +
          '<td>' + escapeHTML(formatEventDate(ev.event_date)) + ' &bull; ' + escapeHTML(ev.session_time || '') + '</td>' +
          '<td><span class="spec-pill">' + escapeHTML(ev.status || 'Scheduled') + '</span></td>' +
          '<td>' +
            '<button type="button" class="admin-action-btn-sm btn-edit-event" data-event=\'' + escapeHTML(JSON.stringify(ev)) + '\'>Edit</button> ' +
            '<button type="button" class="admin-action-btn-sm danger btn-delete-event" data-id="' + escapeHTML(ev.id) + '">Delete</button>' +
          '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    } catch (e) {
      console.warn('Error loading admin events:', e);
    }
  }

  async function loadAdminRoster() {
    var tbody = document.getElementById('admin-roster-tbody');
    if (!tbody) return;
    try {
      var res = await fetch('/api/roster');
      var data = await res.json();
      if (!data.success || !Array.isArray(data.drivers)) return;
      var drivers = data.drivers;
      var html = '';
      drivers.forEach(function (d) {
        var isAdminPill = (d.isAdmin || d.is_admin === 1) ? '<span class="admin-badge" style="font-size: 0.68rem; padding: 0.15rem 0.4rem;">ADMIN</span>' : '<span style="color:var(--text-subtle);">Driver</span>';
        html += '<tr data-driver-id="' + escapeHTML(d.id) + '">' +
          '<td><strong>' + escapeHTML(d.alias) + '</strong>' + (d.pronouns ? ' <small style="color:var(--text-muted);">(' + escapeHTML(d.pronouns) + ')</small>' : '') + '</td>' +
          '<td><span class="driver-num-plate">#' + escapeHTML(d.carNumber || '00') + '</span></td>' +
          '<td><span class="div-pill">' + escapeHTML(d.division || 'Spec Racing') + '</span></td>' +
          '<td><span class="sim-badge">' + escapeHTML(d.sim || 'iRacing') + '</span></td>' +
          '<td>' + isAdminPill + '</td>' +
          '<td>' +
            '<button type="button" class="admin-action-btn-sm btn-edit-driver" data-driver=\'' + escapeHTML(JSON.stringify(d)) + '\'>Edit</button> ' +
            '<button type="button" class="admin-action-btn-sm danger btn-delete-driver" data-id="' + escapeHTML(d.id) + '" data-alias="' + escapeHTML(d.alias) + '">Remove</button>' +
          '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    } catch (e) {
      console.warn('Error loading admin roster:', e);
    }
  }

  async function loadAdminDivisions() {
    var tbody = document.getElementById('admin-divisions-tbody');
    if (!tbody) return;
    try {
      var res = await fetch('/api/divisions');
      var data = await res.json();
      if (!data.success || !Array.isArray(data.divisions)) return;
      var divisions = data.divisions;
      var html = '';
      divisions.forEach(function (div) {
        var specs = '';
        try {
          var arr = typeof div.specs === 'string' ? JSON.parse(div.specs) : (div.specs || []);
          specs = arr.join(', ');
        } catch (e) {
          specs = div.specs || '';
        }
        html += '<tr data-division-id="' + escapeHTML(div.id) + '">' +
          '<td><strong>' + escapeHTML(div.name) + '</strong></td>' +
          '<td><span class="series-badge">' + escapeHTML(div.category || 'Series') + '</span></td>' +
          '<td><span class="sim-badge">' + escapeHTML(div.sim || 'iRacing') + '</span></td>' +
          '<td style="font-size:0.88rem; color:var(--text-chrome);">' + escapeHTML(div.tagline || specs) + '</td>' +
          '<td>' +
            '<button type="button" class="admin-action-btn-sm btn-edit-division" data-division=\'' + escapeHTML(JSON.stringify(div)) + '\'>Edit</button> ' +
            '<button type="button" class="admin-action-btn-sm danger btn-delete-division" data-id="' + escapeHTML(div.id) + '" data-name="' + escapeHTML(div.name) + '">Delete</button>' +
          '</td>' +
        '</tr>';
      });
      tbody.innerHTML = html;
    } catch (e) {
      console.warn('Error loading admin divisions:', e);
    }
  }

  async function shiftScheduleWeeks(weeks) {
    var feedbackEl = document.getElementById('admin-shift-feedback');
    if (feedbackEl) {
      feedbackEl.style.display = 'block';
      feedbackEl.style.background = 'rgba(143, 96, 214, 0.15)';
      feedbackEl.style.color = 'var(--hm-purple-bright)';
      feedbackEl.textContent = 'Shifting schedule by ' + weeks + ' week(s)...';
    }

    try {
      var res = await fetch('/api/admin/events/shift', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Id': getAdminAuthHeader()
        },
        body: JSON.stringify({
          weeks: weeks,
          adminId: getAdminAuthHeader()
        })
      });
      var result = await res.json();
      if (!result.success) throw new Error(result.message || 'Failed to shift schedule.');

      if (feedbackEl) {
        feedbackEl.style.background = 'rgba(46, 204, 113, 0.15)';
        feedbackEl.style.color = 'var(--telemetry-green)';
        feedbackEl.textContent = 'Success: Race schedule successfully shifted by ' + weeks + ' week(s)!';
        setTimeout(function () {
          feedbackEl.style.display = 'none';
        }, 5000);
      }

      // Refresh views
      loadAdminEvents();
      fetchEvents();
    } catch (err) {
      if (feedbackEl) {
        feedbackEl.style.background = 'rgba(231, 76, 60, 0.15)';
        feedbackEl.style.color = '#ff6b6b';
        feedbackEl.textContent = 'Shift error: ' + (err.message || 'Could not shift schedule.');
      }
    }
  }

  function initAdminPortal() {
    if (!isCurrentDriverAdmin()) {
      updateUI();
      return;
    }
    loadAdminEvents();
    loadAdminRoster();
    loadAdminDivisions();
  }

  // --- UI Update & Rendering ---

  function updateUI() {
    var navAuthBtn = document.getElementById('nav-auth-btn');
    var passCard = document.getElementById('paddock-pass-card');
    var formView = document.getElementById('portal-forms-view');
    var dashboardView = document.getElementById('portal-dashboard-view');
    var navAdmin = document.getElementById('nav-item-admin');
    var dashAdminBtn = document.getElementById('dash-admin-btn');
    var adminUnauth = document.getElementById('admin-unauthorized-banner');
    var adminAuth = document.getElementById('admin-authorized-panel');
    var adminUserDisplay = document.getElementById('admin-user-display');
    var isAdmin = isCurrentDriverAdmin();

    // Admin Controls visibility
    if (navAdmin) navAdmin.style.display = isAdmin ? 'list-item' : 'none';
    if (dashAdminBtn) dashAdminBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    if (adminUserDisplay) {
      adminUserDisplay.textContent = currentDriver ? currentDriver.alias : 'Admin';
    }
    if (adminUnauth && adminAuth) {
      if (isAdmin) {
        adminUnauth.style.display = 'none';
        adminAuth.style.display = 'block';
      } else {
        adminUnauth.style.display = 'block';
        adminAuth.style.display = 'none';
      }
    }

    // Header nav button
    if (navAuthBtn) {
      if (currentDriver) {
        navAuthBtn.innerHTML = `
          <span class="nav-driver-badge">#${currentDriver.carNumber}</span>
          <span>${escapeHTML(currentDriver.alias)}</span>
        `;
        navAuthBtn.classList.add('logged-in');
        navAuthBtn.setAttribute('title', 'View Driver Paddock Pass');
      } else {
        navAuthBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          Driver Sign In
        `;
        navAuthBtn.classList.remove('logged-in');
      }
    }

    // Toggle forms vs dashboard
    if (formView && dashboardView) {
      if (currentDriver) {
        formView.style.display = 'none';
        dashboardView.style.display = 'block';
        fillDashboard(currentDriver);
      } else {
        formView.style.display = 'block';
        dashboardView.style.display = 'none';
      }
    }

    // Live Paddock Pass card
    if (passCard) {
      renderPaddockPass(passCard, currentDriver || getLivePreviewData());
    }
  }

  function getLivePreviewData() {
    var alias = document.getElementById('signup-alias');
    var num = document.getElementById('signup-number');
    var sim = document.getElementById('signup-sim');
    var div = document.getElementById('signup-division');
    var pron = document.getElementById('signup-pronouns');

    return {
      alias: (alias && alias.value.trim()) || 'YOUR DRIVER NAME',
      carNumber: (num && num.value.trim()) || '42',
      sim: (sim && sim.value) || 'iRacing',
      division: (div && div.value) || 'Spec Racing',
      pronouns: (pron && pron.value.trim()) || 'she/her',
      discord: 'Community Paddock',
      telemetryId: 'SIM-READY',
      status: 'Ready to Register',
      joinedDate: '2026 Season'
    };
  }

  function renderPaddockPass(cardEl, data) {
    cardEl.innerHTML = `
      <div class="pass-inner">
        <div class="pass-top">
          <div class="pass-brand">
            <img src="assets/img/hm-shield.png" alt="HM Shield" class="pass-shield-icon" width="34" height="30">
            <div>
              <span class="pass-org">HER MOTORSPORT</span>
              <span class="pass-sub">OFFICIAL PADDOCK PASS</span>
            </div>
          </div>
          <div class="pass-num-badge">#${escapeHTML(String(data.carNumber || '00'))}</div>
        </div>

        <div class="pass-driver-info">
          <div class="pass-name-row">
            <h3 class="pass-driver-name">${escapeHTML(data.alias || 'DRIVER')}</h3>
            ${data.pronouns ? `<span class="pass-pronouns">${escapeHTML(data.pronouns)}</span>` : ''}
          </div>
          <div class="pass-details-grid">
            <div class="pass-cell">
              <span class="pass-label">Division</span>
              <span class="pass-value highlight">${escapeHTML(data.division || 'Spec Racing')}</span>
            </div>
            <div class="pass-cell">
              <span class="pass-label">Primary Sim</span>
              <span class="pass-value">${escapeHTML(data.sim || 'iRacing')}</span>
            </div>
            <div class="pass-cell">
              <span class="pass-label">Status</span>
              <span class="pass-value ok">${escapeHTML(data.status || 'Active')}</span>
            </div>
            <div class="pass-cell">
              <span class="pass-label">Accreditation</span>
              <span class="pass-value mono">${escapeHTML(data.carNumber ? 'HM-2026-#' + data.carNumber : 'HM-2026-GRID')}</span>
            </div>
          </div>
        </div>

        <div class="pass-bottom">
          <div class="pass-barcode" aria-hidden="true">
            <span>||| | |||| || ||| |||| | || ||||| ||| |</span>
          </div>
          <span class="pass-expiry">VALID: 2026 CHAMPIONSHIP</span>
        </div>
      </div>
    `;
  }

  function fillDashboard(driver) {
    var nameEl = document.getElementById('dash-driver-name');
    var numEl = document.getElementById('dash-car-number');
    var divEl = document.getElementById('dash-division');
    var simEl = document.getElementById('dash-sim');
    var discEl = document.getElementById('dash-discord');
    var twitchEl = document.getElementById('dash-twitch');

    if (nameEl) nameEl.textContent = driver.alias;
    if (numEl) numEl.textContent = '#' + driver.carNumber;
    if (divEl) divEl.textContent = driver.division;
    if (simEl) simEl.textContent = driver.sim;
    if (discEl) discEl.textContent = driver.discord || 'Not linked';
    if (twitchEl) twitchEl.textContent = driver.twitch || 'None';
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Attach Event Listeners ---

  function initMembers() {
    updateUI();
    fetchRoster();

    // Live typing on signup inputs -> live updates Paddock Pass
    var inputIds = ['signup-alias', 'signup-number', 'signup-sim', 'signup-division', 'signup-pronouns'];
    inputIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          var passCard = document.getElementById('paddock-pass-card');
          if (passCard && !currentDriver) renderPaddockPass(passCard, getLivePreviewData());
        });
        el.addEventListener('change', function () {
          var passCard = document.getElementById('paddock-pass-card');
          if (passCard && !currentDriver) renderPaddockPass(passCard, getLivePreviewData());
        });
      }
    });

    // Password Reveal logic
    document.addEventListener('click', function(e) {
      var btn = e.target.closest('.btn-reveal');
      if (!btn) return;
      e.preventDefault();
      var wrap = btn.closest('.password-wrap');
      if (wrap) {
        var input = wrap.querySelector('input');
        if (input) {
          if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
          } else {
            input.type = 'password';
            btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
          }
        }
      }
    });

    // Profile & Account Dashboard UI
    var dashboardView = document.getElementById('portal-dashboard-view');
    var profileView = document.getElementById('portal-profile-view');
    var accountView = document.getElementById('portal-account-view');
    var btnEditProfile = document.getElementById('btn-edit-profile');
    var btnAccountSettings = document.getElementById('btn-account-settings');
    var backBtns = document.querySelectorAll('.btn-back-dashboard');

    if (btnEditProfile) {
      btnEditProfile.addEventListener('click', function() {
        dashboardView.style.display = 'none';
        if (accountView) accountView.style.display = 'none';
        if (profileView) {
          profileView.style.display = 'block';
          if (currentDriver) {
            document.getElementById('edit-alias').value = currentDriver.alias || '';
            document.getElementById('edit-pronouns').value = currentDriver.pronouns || '';
            document.getElementById('edit-number').value = currentDriver.carNumber || '';
            document.getElementById('edit-sim').value = currentDriver.sim || 'iRacing';
            document.getElementById('edit-division').value = currentDriver.division || 'Spec Racing';
            document.getElementById('edit-discord').value = currentDriver.discord || '';
            document.getElementById('edit-twitch').value = currentDriver.twitch || '';
          }
        }
      });
    }

    if (btnAccountSettings) {
      btnAccountSettings.addEventListener('click', function() {
        dashboardView.style.display = 'none';
        if (profileView) profileView.style.display = 'none';
        if (accountView) accountView.style.display = 'block';
      });
    }

    backBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        if (profileView) profileView.style.display = 'none';
        if (accountView) accountView.style.display = 'none';
        dashboardView.style.display = 'block';
      });
    });

    // Form tab toggling
    var tabSignup = document.getElementById('tab-btn-signup');
    var tabLogin = document.getElementById('tab-btn-login');
    var formSignup = document.getElementById('form-signup');
    var formLogin = document.getElementById('form-login');

    if (tabSignup && tabLogin && formSignup && formLogin) {
      tabSignup.addEventListener('click', function (e) {
        e.preventDefault();
        tabSignup.classList.add('active');
        tabLogin.classList.remove('active');
        formSignup.style.display = 'grid';
        formLogin.style.display = 'none';
      });
      tabLogin.addEventListener('click', function (e) {
        e.preventDefault();
        tabLogin.classList.add('active');
        tabSignup.classList.remove('active');
        formSignup.style.display = 'none';
        formLogin.style.display = 'grid';
      });
    }

    // Signup submission
    var btnSignup = document.getElementById('btn-submit-signup');
    async function handleSignup(e) {
      if (e) e.preventDefault();
      var errBox = document.getElementById('signup-error');
      if (errBox) errBox.textContent = '';

      var aliasInput = document.getElementById('signup-alias');
      var emailInput = document.getElementById('signup-email');
      var passInput = document.getElementById('signup-password');
      var confInput = document.getElementById('signup-confirm');
      var numInput = document.getElementById('signup-number');
      var simInput = document.getElementById('signup-sim');
      var divInput = document.getElementById('signup-division');
      var pronInput = document.getElementById('signup-pronouns');
      var discInput = document.getElementById('signup-discord');
      var twitchInput = document.getElementById('signup-twitch');

      var alias = aliasInput ? aliasInput.value.trim() : '';
      if (!alias) {
        if (errBox) errBox.textContent = 'Please enter your Driver Name / Alias.';
        if (aliasInput) aliasInput.focus();
        return;
      }

      var email = emailInput ? emailInput.value.trim() : '';
      var password = passInput ? passInput.value : '';
      var confirm = confInput ? confInput.value : '';

      if (password && confirm && password !== confirm) {
        if (errBox) errBox.textContent = 'Passwords do not match.';
        return;
      }

      try {
        var profile = await registerDriver({
          alias: alias,
          email: email || (alias.toLowerCase().replace(/[^a-z0-9]/g, '') + '@paddock.sim'),
          password: password || 'pass123',
          carNumber: numInput ? numInput.value : '42',
          sim: simInput ? simInput.value : 'iRacing',
          division: divInput ? divInput.value : 'Spec Racing',
          pronouns: pronInput ? pronInput.value : 'she/her',
          discord: discInput ? discInput.value.trim() : '',
          twitch: twitchInput ? twitchInput.value.trim() : ''
        });

        var successBox = document.getElementById('signup-success');
        if (successBox) {
          successBox.textContent = 'Registration successful! Driver Pass added to the Grid.';
          successBox.style.display = 'block';
        }
        var formSignupEl = document.getElementById('form-signup');
        if (formSignupEl) formSignupEl.reset();

        // Switch to login tab
        if (tabLogin) tabLogin.click();
        if (document.getElementById('login-email')) {
          document.getElementById('login-email').value = profile.email;
        }
      } catch (err) {
        if (errBox) errBox.textContent = err.message || 'Error registering driver.';
      }
    }

    if (btnSignup) btnSignup.addEventListener('click', handleSignup);
    if (formSignup) formSignup.addEventListener('submit', handleSignup);

    // Login submission
    var btnLogin = document.getElementById('btn-submit-login');
    async function handleLogin(e) {
      if (e) e.preventDefault();
      var errBox = document.getElementById('login-error');
      if (errBox) errBox.textContent = '';

      var emailInput = document.getElementById('login-email');
      var passInput = document.getElementById('login-password');
      var email = emailInput ? emailInput.value.trim() : '';
      var pass = passInput ? passInput.value : '';

      if (!email) {
        if (errBox) errBox.textContent = 'Please enter your email.';
        return;
      }

      try {
        await loginDriver(email, pass);
      } catch (err) {
        if (errBox) errBox.textContent = err.message || 'Invalid login details.';
      }
    }

    if (btnLogin) btnLogin.addEventListener('click', handleLogin);
    if (formLogin) formLogin.addEventListener('submit', handleLogin);

    // Discord button
    var discordBtn = document.getElementById('btn-discord-login');
    if (discordBtn) {
      discordBtn.addEventListener('click', function (e) {
        e.preventDefault();
        loginWithDiscord();
      });
    }

    // Logout button
    var logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', function (e) {
        e.preventDefault();
        logoutDriver();
      });
    }

    // Password Reset handlers
    var forgotLink = document.getElementById('link-forgot-password');
    var backLoginLink = document.getElementById('link-back-login');
    var formForgot = document.getElementById('form-forgot-password');
    var formReset = document.getElementById('form-reset-password');

    if (forgotLink && formLogin && formForgot) {
      forgotLink.addEventListener('click', function(e) {
        e.preventDefault();
        formLogin.style.display = 'none';
        formForgot.style.display = 'grid';
      });
    }

    if (backLoginLink && formLogin && formForgot) {
      backLoginLink.addEventListener('click', function(e) {
        e.preventDefault();
        formForgot.style.display = 'none';
        formLogin.style.display = 'grid';
      });
    }

    var btnForgot = document.getElementById('btn-submit-forgot');
    async function handleForgot(e) {
      if (e) e.preventDefault();
      var errBox = document.getElementById('forgot-error');
      if (errBox) errBox.textContent = '';

      var emailInput = document.getElementById('forgot-email');
      var email = emailInput ? emailInput.value.trim() : '';
      if (!email) {
        if (errBox) errBox.textContent = 'Please enter your email.';
        return;
      }

      try {
        await sendPasswordReset(email);
        var successBox = document.getElementById('signup-success');
        if (successBox) {
          successBox.textContent = 'Password reset request received!';
          successBox.style.display = 'block';
        }
        if (formForgot) formForgot.reset();
        formForgot.style.display = 'none';
        formLogin.style.display = 'grid';
      } catch (err) {
        if (errBox) errBox.textContent = err.message || 'Error sending reset request.';
      }
    }

    if (btnForgot) btnForgot.addEventListener('click', handleForgot);
    if (formForgot) formForgot.addEventListener('submit', handleForgot);

    // Profile Settings Form
    var formProfile = document.getElementById('form-edit-profile');
    if (formProfile) {
      formProfile.addEventListener('submit', async function(e) {
        e.preventDefault();
        var errBox = document.getElementById('edit-profile-error');
        var successBox = document.getElementById('edit-profile-success');
        if (errBox) errBox.textContent = '';
        if (successBox) successBox.style.display = 'none';

        var data = {
          alias: document.getElementById('edit-alias').value.trim(),
          pronouns: document.getElementById('edit-pronouns').value.trim(),
          carNumber: document.getElementById('edit-number').value.trim(),
          sim: document.getElementById('edit-sim').value,
          division: document.getElementById('edit-division').value,
          discord: document.getElementById('edit-discord').value.trim(),
          twitch: document.getElementById('edit-twitch').value.trim()
        };

        if (!data.alias) {
          if (errBox) errBox.textContent = 'Driver Name / Alias is required.';
          return;
        }

        try {
          await updateProfile(data);
          if (successBox) {
            successBox.textContent = 'Profile updated on edge!';
            successBox.style.display = 'block';
          }
        } catch (err) {
          if (errBox) errBox.textContent = err.message || 'Error updating profile.';
        }
      });
    }

    // Account Settings Form
    var formAccount = document.getElementById('form-edit-account');
    if (formAccount) {
      formAccount.addEventListener('submit', async function(e) {
        e.preventDefault();
        var errBox = document.getElementById('edit-account-error');
        var successBox = document.getElementById('edit-account-success');
        if (errBox) errBox.textContent = '';
        if (successBox) successBox.style.display = 'none';

        var email = document.getElementById('edit-email').value.trim();
        var currentPassword = document.getElementById('edit-account-password').value;
        var newPassword = document.getElementById('edit-new-password').value;
        var confirmPassword = document.getElementById('edit-confirm-password').value;

        if (newPassword && newPassword !== confirmPassword) {
          if (errBox) errBox.textContent = 'New passwords do not match.';
          return;
        }

        try {
          await updateAccount({
            email: email,
            current_password: currentPassword,
            new_password: newPassword
          });

          if (successBox) {
            successBox.textContent = 'Account security settings updated successfully!';
            successBox.style.display = 'block';
          }
          formAccount.reset();
        } catch (err) {
          if (errBox) errBox.textContent = err.message || 'Error updating account.';
        }
      });
    }

    // Nav auth button -> scroll to members
    var navAuthBtn = document.getElementById('nav-auth-btn');
    if (navAuthBtn) {
      navAuthBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var portal = document.getElementById('members');
        if (portal) portal.scrollIntoView({ behavior: 'smooth' });
      });
    }

    // --- Game Filter Scope Listeners ---
    function wireGameFilters(containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      container.addEventListener('click', function (e) {
        var btn = e.target.closest('.game-filter-btn');
        if (!btn) return;
        var sim = btn.getAttribute('data-sim') || 'all';
        document.querySelectorAll('#schedule-game-filters .game-filter-btn, #calendar-game-filters .game-filter-btn').forEach(function (b) {
          if (b.getAttribute('data-sim') === sim) {
            b.classList.add('active');
          } else {
            b.classList.remove('active');
          }
        });
        fetchEvents(sim);
      });
    }

    wireGameFilters('schedule-game-filters');
    wireGameFilters('calendar-game-filters');

    // Initial fetch of events & divisions
    fetchEvents('all');
    fetchDivisions();

    // --- Admin Portal Controls & Listeners ---

    // Tabs
    var tabEventsBtn = document.getElementById('tab-admin-events-btn');
    var tabRosterBtn = document.getElementById('tab-admin-roster-btn');
    var tabDivisionsBtn = document.getElementById('tab-admin-divisions-btn');
    var panelEvents = document.getElementById('panel-admin-events');
    var panelRoster = document.getElementById('panel-admin-roster');
    var panelDivisions = document.getElementById('panel-admin-divisions');

    function switchAdminTab(activeBtn, activePanel) {
      [tabEventsBtn, tabRosterBtn, tabDivisionsBtn].forEach(function(b) {
        if (b) {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        }
      });
      [panelEvents, panelRoster, panelDivisions].forEach(function(p) {
        if (p) p.style.display = 'none';
      });
      if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.setAttribute('aria-selected', 'true');
      }
      if (activePanel) activePanel.style.display = 'block';
    }

    if (tabEventsBtn) {
      tabEventsBtn.addEventListener('click', function() {
        switchAdminTab(tabEventsBtn, panelEvents);
        loadAdminEvents();
      });
    }
    if (tabRosterBtn) {
      tabRosterBtn.addEventListener('click', function() {
        switchAdminTab(tabRosterBtn, panelRoster);
        loadAdminRoster();
      });
    }
    if (tabDivisionsBtn) {
      tabDivisionsBtn.addEventListener('click', function() {
        switchAdminTab(tabDivisionsBtn, panelDivisions);
        loadAdminDivisions();
      });
    }

    // Schedule Shifting
    var btnShiftMinus = document.getElementById('btn-shift-minus-1');
    var btnShiftPlus = document.getElementById('btn-shift-plus-1');
    var btnShiftCustom = document.getElementById('btn-shift-custom');

    if (btnShiftMinus) {
      btnShiftMinus.addEventListener('click', function() {
        shiftScheduleWeeks(-1);
      });
    }
    if (btnShiftPlus) {
      btnShiftPlus.addEventListener('click', function() {
        shiftScheduleWeeks(1);
      });
    }
    if (btnShiftCustom) {
      btnShiftCustom.addEventListener('click', function() {
        var wInput = document.getElementById('admin-shift-weeks');
        var w = parseInt(wInput ? wInput.value : '1', 10);
        if (isNaN(w) || w === 0) w = 1;
        shiftScheduleWeeks(w);
      });
    }

    // Admin Events Form & Table
    var btnToggleEventForm = document.getElementById('btn-toggle-event-form');
    var btnCancelEventForm = document.getElementById('btn-cancel-event-form');
    var eventFormPanel = document.getElementById('admin-event-form-panel');
    var formAdminEvent = document.getElementById('form-admin-event');

    if (btnToggleEventForm && eventFormPanel && formAdminEvent) {
      btnToggleEventForm.addEventListener('click', function() {
        formAdminEvent.reset();
        document.getElementById('admin-event-id').value = '';
        document.getElementById('admin-event-form-title').textContent = 'Add Scheduled Event';
        eventFormPanel.style.display = eventFormPanel.style.display === 'block' ? 'none' : 'block';
      });
    }

    if (btnCancelEventForm && eventFormPanel) {
      btnCancelEventForm.addEventListener('click', function() {
        eventFormPanel.style.display = 'none';
      });
    }

    if (formAdminEvent) {
      formAdminEvent.addEventListener('submit', async function(e) {
        e.preventDefault();
        var id = document.getElementById('admin-event-id').value;
        var errEl = document.getElementById('admin-event-error');
        if (errEl) errEl.textContent = '';

        var payload = {
          title: document.getElementById('admin-event-title').value.trim(),
          series: document.getElementById('admin-event-series').value,
          track: document.getElementById('admin-event-track').value.trim(),
          sim: document.getElementById('admin-event-sim').value,
          event_date: document.getElementById('admin-event-date').value,
          session_time: document.getElementById('admin-event-time').value.trim(),
          status: document.getElementById('admin-event-status').value,
          notes: document.getElementById('admin-event-notes').value.trim(),
          adminId: getAdminAuthHeader()
        };

        if (!payload.title || !payload.track || !payload.event_date) {
          if (errEl) errEl.textContent = 'Please fill out all required fields.';
          return;
        }

        try {
          var url = id ? '/api/admin/events/' + encodeURIComponent(id) : '/api/admin/events';
          var method = id ? 'PUT' : 'POST';
          var res = await fetch(url, {
            method: method,
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Id': getAdminAuthHeader()
            },
            body: JSON.stringify(payload)
          });
          var result = await res.json();
          if (!result.success) throw new Error(result.message || 'Error saving event.');

          formAdminEvent.reset();
          if (eventFormPanel) eventFormPanel.style.display = 'none';
          loadAdminEvents();
          fetchEvents();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      });
    }

    var adminEventsTbody = document.getElementById('admin-events-tbody');
    if (adminEventsTbody) {
      adminEventsTbody.addEventListener('click', async function(e) {
        var editBtn = e.target.closest('.btn-edit-event');
        var deleteBtn = e.target.closest('.btn-delete-event');

        if (editBtn) {
          var evData = JSON.parse(editBtn.getAttribute('data-event') || '{}');
          if (evData && eventFormPanel) {
            document.getElementById('admin-event-id').value = evData.id || '';
            document.getElementById('admin-event-title').value = evData.title || '';
            document.getElementById('admin-event-series').value = evData.series || 'Spec Racing Division';
            document.getElementById('admin-event-track').value = evData.track || '';
            document.getElementById('admin-event-sim').value = evData.sim || 'iRacing';
            document.getElementById('admin-event-date').value = evData.event_date || '';
            document.getElementById('admin-event-time').value = evData.session_time || '';
            document.getElementById('admin-event-status').value = evData.status || 'Scheduled';
            document.getElementById('admin-event-notes').value = evData.notes || '';
            document.getElementById('admin-event-form-title').textContent = 'Edit Scheduled Event';
            eventFormPanel.style.display = 'block';
            eventFormPanel.scrollIntoView({ behavior: 'smooth' });
          }
        }

        if (deleteBtn) {
          var id = deleteBtn.getAttribute('data-id');
          if (!id) return;
          if (!confirm('Are you sure you want to delete this scheduled race event?')) return;

          try {
            var res = await fetch('/api/admin/events/' + encodeURIComponent(id), {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': getAdminAuthHeader()
              },
              body: JSON.stringify({ adminId: getAdminAuthHeader() })
            });
            var result = await res.json();
            if (!result.success) throw new Error(result.message || 'Error deleting event.');
            loadAdminEvents();
            fetchEvents();
          } catch (err) {
            alert('Delete failed: ' + err.message);
          }
        }
      });
    }

    // Admin Driver Roster Form & Table
    var driverFormPanel = document.getElementById('admin-driver-form-panel');
    var formAdminDriver = document.getElementById('form-admin-driver');
    var btnCancelDriverForm = document.getElementById('btn-cancel-driver-form');

    if (btnCancelDriverForm && driverFormPanel) {
      btnCancelDriverForm.addEventListener('click', function() {
        driverFormPanel.style.display = 'none';
      });
    }

    if (formAdminDriver) {
      formAdminDriver.addEventListener('submit', async function(e) {
        e.preventDefault();
        var id = document.getElementById('admin-driver-id').value;
        var errEl = document.getElementById('admin-driver-error');
        if (errEl) errEl.textContent = '';

        var payload = {
          alias: document.getElementById('admin-driver-alias').value.trim(),
          carNumber: document.getElementById('admin-driver-number').value.trim(),
          sim: document.getElementById('admin-driver-sim').value,
          division: document.getElementById('admin-driver-division').value,
          status: document.getElementById('admin-driver-status').value,
          is_admin: document.getElementById('admin-driver-is-admin').checked ? 1 : 0,
          adminId: getAdminAuthHeader()
        };

        if (!payload.alias) {
          if (errEl) errEl.textContent = 'Driver alias is required.';
          return;
        }

        try {
          var res = await fetch('/api/admin/drivers/' + encodeURIComponent(id), {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Id': getAdminAuthHeader()
            },
            body: JSON.stringify(payload)
          });
          var result = await res.json();
          if (!result.success) throw new Error(result.message || 'Error updating driver.');

          if (driverFormPanel) driverFormPanel.style.display = 'none';
          loadAdminRoster();
          fetchRoster();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      });
    }

    var adminRosterTbody = document.getElementById('admin-roster-tbody');
    if (adminRosterTbody) {
      adminRosterTbody.addEventListener('click', async function(e) {
        var editBtn = e.target.closest('.btn-edit-driver');
        var deleteBtn = e.target.closest('.btn-delete-driver');

        if (editBtn) {
          var dData = JSON.parse(editBtn.getAttribute('data-driver') || '{}');
          if (dData && driverFormPanel) {
            document.getElementById('admin-driver-id').value = dData.id || '';
            document.getElementById('admin-driver-alias').value = dData.alias || '';
            document.getElementById('admin-driver-number').value = dData.carNumber || '';
            document.getElementById('admin-driver-sim').value = dData.sim || 'iRacing';
            document.getElementById('admin-driver-division').value = dData.division || 'Spec Racing';
            document.getElementById('admin-driver-status').value = dData.status || 'Active Driver';
            document.getElementById('admin-driver-is-admin').checked = Boolean(dData.isAdmin || dData.is_admin);
            driverFormPanel.style.display = 'block';
            driverFormPanel.scrollIntoView({ behavior: 'smooth' });
          }
        }

        if (deleteBtn) {
          var id = deleteBtn.getAttribute('data-id');
          var alias = deleteBtn.getAttribute('data-alias') || 'driver';
          if (!id) return;
          if (!confirm('Are you sure you want to remove ' + alias + ' from the driver roster?')) return;

          try {
            var res = await fetch('/api/admin/drivers/' + encodeURIComponent(id), {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': getAdminAuthHeader()
              },
              body: JSON.stringify({ adminId: getAdminAuthHeader() })
            });
            var result = await res.json();
            if (!result.success) throw new Error(result.message || 'Error deleting driver.');
            loadAdminRoster();
            fetchRoster();
          } catch (err) {
            alert('Delete failed: ' + err.message);
          }
        }
      });
    }

    // Admin Divisions Form & Table
    var btnToggleDivForm = document.getElementById('btn-toggle-division-form');
    var btnCancelDivForm = document.getElementById('btn-cancel-division-form');
    var divFormPanel = document.getElementById('admin-division-form-panel');
    var formAdminDiv = document.getElementById('form-admin-division');

    if (btnToggleDivForm && divFormPanel && formAdminDiv) {
      btnToggleDivForm.addEventListener('click', function() {
        formAdminDiv.reset();
        document.getElementById('admin-division-id').value = '';
        document.getElementById('admin-division-form-title').textContent = 'Add Championship Division';
        divFormPanel.style.display = divFormPanel.style.display === 'block' ? 'none' : 'block';
      });
    }

    if (btnCancelDivForm && divFormPanel) {
      btnCancelDivForm.addEventListener('click', function() {
        divFormPanel.style.display = 'none';
      });
    }

    if (formAdminDiv) {
      formAdminDiv.addEventListener('submit', async function(e) {
        e.preventDefault();
        var id = document.getElementById('admin-division-id').value;
        var errEl = document.getElementById('admin-division-error');
        if (errEl) errEl.textContent = '';

        var specsRaw = document.getElementById('admin-div-specs').value.trim();
        var specsArr = specsRaw ? specsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

        var payload = {
          name: document.getElementById('admin-div-name').value.trim(),
          category: document.getElementById('admin-div-category').value.trim(),
          tagline: document.getElementById('admin-div-tagline').value.trim(),
          sim: document.getElementById('admin-div-sim').value,
          description: document.getElementById('admin-div-desc').value.trim(),
          specs: specsArr,
          adminId: getAdminAuthHeader()
        };

        if (!payload.name || !payload.description) {
          if (errEl) errEl.textContent = 'Division name and description are required.';
          return;
        }

        try {
          var url = id ? '/api/admin/divisions/' + encodeURIComponent(id) : '/api/admin/divisions';
          var method = id ? 'PUT' : 'POST';
          var res = await fetch(url, {
            method: method,
            headers: {
              'Content-Type': 'application/json',
              'X-Admin-Id': getAdminAuthHeader()
            },
            body: JSON.stringify(payload)
          });
          var result = await res.json();
          if (!result.success) throw new Error(result.message || 'Error saving division.');

          formAdminDiv.reset();
          if (divFormPanel) divFormPanel.style.display = 'none';
          loadAdminDivisions();
          fetchDivisions();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        }
      });
    }

    var adminDivisionsTbody = document.getElementById('admin-divisions-tbody');
    if (adminDivisionsTbody) {
      adminDivisionsTbody.addEventListener('click', async function(e) {
        var editBtn = e.target.closest('.btn-edit-division');
        var deleteBtn = e.target.closest('.btn-delete-division');

        if (editBtn) {
          var divData = JSON.parse(editBtn.getAttribute('data-division') || '{}');
          if (divData && divFormPanel) {
            document.getElementById('admin-division-id').value = divData.id || '';
            document.getElementById('admin-div-name').value = divData.name || '';
            document.getElementById('admin-div-category').value = divData.category || '';
            document.getElementById('admin-div-tagline').value = divData.tagline || '';
            document.getElementById('admin-div-sim').value = divData.sim || 'iRacing';
            document.getElementById('admin-div-desc').value = divData.description || '';
            
            var specs = '';
            try {
              specs = typeof divData.specs === 'string' ? JSON.parse(divData.specs).join(', ') : (divData.specs || []).join(', ');
            } catch (err) {
              specs = divData.specs || '';
            }
            document.getElementById('admin-div-specs').value = specs;
            document.getElementById('admin-division-form-title').textContent = 'Edit Championship Division';
            divFormPanel.style.display = 'block';
            divFormPanel.scrollIntoView({ behavior: 'smooth' });
          }
        }

        if (deleteBtn) {
          var id = deleteBtn.getAttribute('data-id');
          var name = deleteBtn.getAttribute('data-name') || 'division';
          if (!id) return;
          if (!confirm('Are you sure you want to delete ' + name + '?')) return;

          try {
            var res = await fetch('/api/admin/divisions/' + encodeURIComponent(id), {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'X-Admin-Id': getAdminAuthHeader()
              },
              body: JSON.stringify({ adminId: getAdminAuthHeader() })
            });
            var result = await res.json();
            if (!result.success) throw new Error(result.message || 'Error deleting division.');
            loadAdminDivisions();
            fetchDivisions();
          } catch (err) {
            alert('Delete failed: ' + err.message);
          }
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMembers);
  } else {
    initMembers();
  }

  window.HerMembers = {
    getDriver: function () { return currentDriver; },
    isAdmin: isCurrentDriverAdmin,
    register: registerDriver,
    login: loginDriver,
    loginWithDiscord: loginWithDiscord,
    logout: logoutDriver,
    updateUI: updateUI,
    fetchRoster: fetchRoster,
    fetchEvents: fetchEvents,
    fetchDivisions: fetchDivisions,
    renderCalendar: function() { fetchEvents(currentSimFilter); },
    renderDivisions: fetchDivisions,
    initAdmin: initAdminPortal
  };
})();
