/**
 * Her Motorsport — Single Page Application (SPA) Router & UI Controller
 */
(function () {
  'use strict';

  // --- Mobile Nav Controller ---
  var navBtn = document.querySelector('.nav-toggle');
  var nav = document.getElementById('site-nav');

  if (navBtn && nav) {
    navBtn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      navBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) {
        nav.classList.remove('open');
        navBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        nav.classList.remove('open');
        navBtn.setAttribute('aria-expanded', 'false');
        navBtn.focus();
      }
    });
  }

  // --- Footer Current Year ---
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  // --- SPA Router ---
  var viewHome = document.getElementById('view-home');
  var viewConduct = document.getElementById('view-conduct');
  var viewCalendar = document.getElementById('view-calendar');
  var viewDivisions = document.getElementById('view-divisions');
  var viewAdmin = document.getElementById('view-admin');
  var allViews = [viewHome, viewConduct, viewCalendar, viewDivisions, viewAdmin];
  var navLinks = document.querySelectorAll('.nav a, .site-footer a');

  function setActiveView(targetView) {
    allViews.forEach(function (v) {
      if (v) v.classList.remove('active');
    });
    if (targetView) targetView.classList.add('active');
  }

  function handleRoute() {
    var rawHash = window.location.hash || '';
    var hash = rawHash.toLowerCase();

    if (hash === '#conduct') {
      setActiveView(viewConduct);
      document.title = 'Code of Conduct — Her Motorsport';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateActiveNav('#conduct');
    } else if (hash === '#calendar') {
      setActiveView(viewCalendar);
      document.title = 'Race Calendar — Her Motorsport';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateActiveNav('#calendar');
      if (window.HerMembers && window.HerMembers.renderCalendar) {
        window.HerMembers.renderCalendar();
      }
    } else if (hash === '#divisions') {
      setActiveView(viewDivisions);
      document.title = 'Championship Divisions — Her Motorsport';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateActiveNav('#divisions');
      if (window.HerMembers && window.HerMembers.renderDivisions) {
        window.HerMembers.renderDivisions();
      }
    } else if (hash === '#admin') {
      setActiveView(viewAdmin);
      document.title = 'Race Control Admin — Her Motorsport';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateActiveNav('#admin');
      if (window.HerMembers && window.HerMembers.initAdmin) {
        window.HerMembers.initAdmin();
      }
    } else {
      // Main Paddock SPA view
      setActiveView(viewHome);
      document.title = 'Her Motorsport — Sim Racing Community';
      updateActiveNav(hash || '#about');

      // Deep link scrolling inside Home view
      if (hash && hash !== '#home' && hash !== '#') {
        var targetEl = document.querySelector(rawHash);
        if (targetEl) {
          setTimeout(function () {
            targetEl.scrollIntoView({ behavior: 'smooth' });
          }, 40);
        }
      } else if (hash === '#home' || !hash) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }

  function updateActiveNav(activeHash) {
    navLinks.forEach(function (link) {
      var href = link.getAttribute('href') || '';
      var cleanHref = href.replace('index.html', '');

      if (cleanHref === activeHash || (activeHash === '#conduct' && cleanHref === '#conduct')) {
        link.setAttribute('aria-current', 'page');
      } else if (cleanHref.startsWith('#')) {
        link.removeAttribute('aria-current');
      }
    });
  }

  // Listen to navigation events
  window.addEventListener('hashchange', handleRoute);
  document.addEventListener('DOMContentLoaded', handleRoute);

  // Initial trigger
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    handleRoute();
  }
})();
