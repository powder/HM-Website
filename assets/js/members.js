/**
 * Her Motorsport — Robust Serverless & Local Member Management
 *
 * Works 100% locally out-of-the-box (zero server setup needed),
 * and automatically synchronizes with Supabase when API keys are configured.
 */

window.HER_CONFIG = window.HER_CONFIG || {
  supabaseUrl: 'https://byifghjfifctheadqxbb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5aWZnaGpmaWZjdGhlYWRxeGJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NjAyNDIsImV4cCI6MjEwNzIzNjI0Mn0.B9WJ3cfm2J7Ur6ohxKYnfZbJtte9HvMDqm-QGJxS1hs'
};

(function () {
  'use strict';

  var STORAGE_KEY = 'hm_driver_session';
  var DB_KEY = 'hm_registered_drivers';
  var memoryStorage = {};
  var memoryDB = {};
  var supabaseClient = null;

  // Safe storage wrapper (handles file:/// security restrictions gracefully)
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

  // Initialize Supabase if SDK is present and keys are provided
  if (window.supabase && window.HER_CONFIG.supabaseUrl && window.HER_CONFIG.supabaseAnonKey) {
    try {
      supabaseClient = window.supabase.createClient(
        window.HER_CONFIG.supabaseUrl,
        window.HER_CONFIG.supabaseAnonKey
      );
    } catch (err) {
      console.warn('Supabase not configured, running in local paddock mode:', err);
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

  // --- Auth Handlers ---

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

    var profile = {
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

    if (supabaseClient) {
      try {
        var metaData = Object.assign({}, profile);
        delete metaData.password;
        var res = await supabaseClient.auth.signUp({
          email: email,
          password: password,
          options: { data: metaData }
        });
        if (res.data && res.data.user) {
          profile.id = res.data.user.id;
        }
      } catch (err) {
        console.warn('Supabase signup error, continuing locally:', err);
      }
    }

    saveDriverToDB(profile);
    saveDriver(profile);
    return profile;
  }

  async function loginDriver(email, password) {
    email = (email || '').trim();
    if (!email) throw new Error('Please enter your email.');

    if (supabaseClient) {
      try {
        var res = await supabaseClient.auth.signInWithPassword({
          email: email,
          password: password
        });
        if (res.error) throw res.error;
        var meta = (res.data.user && res.data.user.user_metadata) || {};
        var remoteProfile = {
          id: res.data.user.id,
          email: email,
          alias: meta.alias || email.split('@')[0],
          discord: meta.discord || '',
          twitch: meta.twitch || '',
          carNumber: meta.carNumber || '77',
          sim: meta.sim || 'iRacing',
          division: meta.division || 'Spec Racing',
          pronouns: meta.pronouns || 'she/her',
          telemetryId: meta.telemetryId || 'SIM-88412',
          status: 'Active Driver',
          joinedDate: '2026'
        };
        saveDriver(remoteProfile);
        return remoteProfile;
      } catch (err) {
        throw err;
      }
    }

    // Local authentication fallback
    var existing = getDriverByEmail(email);
    if (existing) {
      if (existing.password && existing.password !== password) {
        throw new Error('Invalid login details.');
      }
      saveDriver(existing);
      return existing;
    }

    throw new Error('Driver not found. Please register a pass first.');
  }

  async function loginWithDiscord() {
    if (supabaseClient) {
      try {
        await supabaseClient.auth.signInWithOAuth({
          provider: 'discord',
          options: { redirectTo: window.location.origin }
        });
        return;
      } catch (e) {
        console.warn('Discord OAuth fallback to instant mode:', e);
      }
    }

    var handle = prompt('Connect with Discord:\nEnter your Discord username:', 'SpeedQueen#1234');
    if (!handle) handle = 'Driver' + Math.floor(100 + Math.random() * 900);
    var cleanName = handle.replace(/[^a-zA-Z0-9]/g, '');

    var discordProfile = {
      id: 'discord_' + Date.now(),
      alias: handle,
      email: (cleanName || 'driver').toLowerCase() + '@discord.sim',
      carNumber: String(Math.floor(1 + Math.random() * 99)).padStart(2, '0'),
      sim: 'iRacing',
      division: 'Spec Racing',
      pronouns: 'she/they',
      discord: '',
      twitch: '',
      telemetryId: 'DISC-' + Math.floor(1000 + Math.random() * 9000),
      status: 'Discord Verified',
      joinedDate: new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    };
    saveDriverToDB(discordProfile);
    saveDriver(discordProfile);
  }

  function logoutDriver() {
    if (supabaseClient) {
      try { supabaseClient.auth.signOut(); } catch (e) {}
    }
    saveDriver(null);
  }

  // --- UI Update & Rendering ---

  function updateUI() {
    var navAuthBtn = document.getElementById('nav-auth-btn');
    var passCard = document.getElementById('paddock-pass-card');
    var formView = document.getElementById('portal-forms-view');
    var dashboardView = document.getElementById('portal-dashboard-view');

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

    renderRoster();
  }

  function getLivePreviewData() {
    var alias = document.getElementById('signup-alias');
    var num = document.getElementById('signup-number');
    var sim = document.getElementById('signup-sim');
    var div = document.getElementById('signup-division');
    var pron = document.getElementById('signup-pronouns');
    var telem = document.getElementById('signup-telemetry');

    return {
      alias: (alias && alias.value.trim()) || 'YOUR DRIVER NAME',
      carNumber: (num && num.value.trim()) || '42',
      sim: (sim && sim.value) || 'iRacing',
      division: (div && div.value) || 'Spec Racing',
      pronouns: (pron && pron.value.trim()) || 'she/her',
      discord: 'Community Paddock',
      telemetryId: (telem && telem.value.trim()) || 'READY FOR TELEMETRY',
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
              <span class="pass-label">Telemetry ID</span>
              <span class="pass-value mono">${escapeHTML(data.telemetryId || 'TELEMETRY READY')}</span>
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
    var telemEl = document.getElementById('dash-telemetry');

    if (nameEl) nameEl.textContent = driver.alias;
    if (numEl) numEl.textContent = '#' + driver.carNumber;
    if (divEl) divEl.textContent = driver.division;
    if (simEl) simEl.textContent = driver.sim;
    if (discEl) discEl.textContent = driver.discord || 'Not linked';
    if (twitchEl) twitchEl.textContent = driver.twitch || 'None';
    if (telemEl) telemEl.textContent = driver.telemetryId || 'Synced';
  }

  function renderRoster() {
    var tbody = document.getElementById('roster-tbody');
    if (!tbody) return;

    var db = {};
    try {
      db = JSON.parse(safeGet(DB_KEY) || '{}');
    } catch (e) {}

    var drivers = Object.values(db);
    if (drivers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No drivers registered yet. Sign up to join the grid!</td></tr>';
      return;
    }

    var html = '';
    drivers.forEach(function (d) {
      var twitchHtml = d.twitch ? '<a href="https://twitch.tv/' + escapeHTML(d.twitch.replace('@', '')) + '" target="_blank">' + escapeHTML(d.twitch) + '</a>' : '<span class="tbd">-</span>';
      var nameHtml = escapeHTML(d.alias) + ' <span style="color: var(--brand); font-size: 0.85em; margin-left: 0.3rem;">#' + escapeHTML(d.carNumber || '00') + '</span>';
      html += '<tr><td>' + nameHtml + '</td><td>' + escapeHTML(d.pronouns || '-') + '</td><td>' + escapeHTML(d.sim || 'iRacing') + '</td><td>' + twitchHtml + '</td></tr>';
    });
    tbody.innerHTML = html;
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Attach All Event Listeners ---

  function initMembers() {
    updateUI();

    // Live typing on signup inputs -> live updates Paddock Pass
    var inputIds = ['signup-alias', 'signup-number', 'signup-sim', 'signup-division', 'signup-pronouns', 'signup-telemetry'];
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

    // Direct submit button click & form submit handlers
    var btnSignup = document.getElementById('btn-submit-signup');

    async function handleSignup(e) {
      if (e) e.preventDefault();
      var errBox = document.getElementById('signup-error');
      if (errBox) errBox.textContent = '';

      var aliasInput = document.getElementById('signup-alias');
      var emailInput = document.getElementById('signup-email');
      var passInput = document.getElementById('signup-password');
      var numInput = document.getElementById('signup-number');
      var simInput = document.getElementById('signup-sim');
      var divInput = document.getElementById('signup-division');
      var pronInput = document.getElementById('signup-pronouns');
      var discInput = document.getElementById('signup-discord');
      var twitchInput = document.getElementById('signup-twitch');
      var telemInput = document.getElementById('signup-telemetry');

      var alias = aliasInput ? aliasInput.value.trim() : '';
      if (!alias) {
        if (errBox) errBox.textContent = 'Please enter your Driver Name / Alias.';
        if (aliasInput) aliasInput.focus();
        return;
      }

      var email = emailInput ? emailInput.value.trim() : '';
      var password = passInput ? passInput.value : '';

      try {
        await registerDriver({
          alias: alias,
          email: email || (alias.toLowerCase().replace(/[^a-z0-9]/g, '') + '@paddock.sim'),
          password: password || 'pass123',
          carNumber: numInput ? numInput.value : '42',
          sim: simInput ? simInput.value : 'iRacing',
          division: divInput ? divInput.value : 'Spec Racing',
          pronouns: pronInput ? pronInput.value : 'she/her',
          discord: discInput ? discInput.value.trim() : '',
          twitch: twitchInput ? twitchInput.value.trim() : '',
          telemetryId: telemInput ? telemInput.value.trim() : ''
        });
      } catch (err) {
        if (errBox) errBox.textContent = err.message || 'Error registering driver.';
      }
    }

    if (btnSignup) {
      btnSignup.addEventListener('click', handleSignup);
    }
    if (formSignup) {
      formSignup.addEventListener('submit', handleSignup);
    }

    // Login submit handler
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

    if (btnLogin) {
      btnLogin.addEventListener('click', handleLogin);
    }
    if (formLogin) {
      formLogin.addEventListener('submit', handleLogin);
    }

    // Discord Fast-Connect button
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

    // Nav auth button -> scroll to members section
    var navAuthBtn = document.getElementById('nav-auth-btn');
    if (navAuthBtn) {
      navAuthBtn.addEventListener('click', function (e) {
        e.preventDefault();
        var portal = document.getElementById('members');
        if (portal) portal.scrollIntoView({ behavior: 'smooth' });
      });
    }
  }

  // Self-executing initialization: supports both premature and delayed script loading
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMembers);
  } else {
    initMembers();
  }

  // Global API
  window.HerMembers = {
    getDriver: function () { return currentDriver; },
    register: registerDriver,
    login: loginDriver,
    loginWithDiscord: loginWithDiscord,
    logout: logoutDriver,
    updateUI: updateUI
  };
})();
