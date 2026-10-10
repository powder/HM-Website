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
  var navLinks = document.querySelectorAll('.nav a, .site-footer a');

  function handleRoute() {
    var rawHash = window.location.hash || '';
    var hash = rawHash.toLowerCase();

    if (hash === '#conduct') {
      // Activate Code of Conduct SPA view
      if (viewHome) viewHome.classList.remove('active');
      if (viewConduct) viewConduct.classList.add('active');

      document.title = 'Code of Conduct — Her Motorsport';
      window.scrollTo({ top: 0, behavior: 'smooth' });
      updateActiveNav('#conduct');
    } else {
      // Activate Main Paddock SPA view
      if (viewConduct) viewConduct.classList.remove('active');
      if (viewHome) viewHome.classList.add('active');

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
