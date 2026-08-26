/* ============================================
   LCO CONNECT — Main JavaScript
   Phase 0: Foundation
   ============================================ */

(function () {
  'use strict';

  /* ── DOM REFERENCES ── */
  var navEl = document.querySelector('.nav');
  var navToggle = document.getElementById('navToggle');
  var mobileMenu = document.getElementById('mobileMenu');

  /* ── MOBILE NAVIGATION ── */
  function closeMobileMenu() {
    navToggle.classList.remove('open');
    mobileMenu.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
    navToggle.setAttribute('aria-label', 'Open menu');
  }

  function openMobileMenu() {
    navToggle.classList.add('open');
    mobileMenu.classList.add('open');
    navToggle.setAttribute('aria-expanded', 'true');
    navToggle.setAttribute('aria-label', 'Close menu');
  }

  navToggle.addEventListener('click', function () {
    if (mobileMenu.classList.contains('open')) {
      closeMobileMenu();
    } else {
      openMobileMenu();
    }
  });

  // Close mobile menu when a link or button inside it is clicked
  mobileMenu.querySelectorAll('a, .btn').forEach(function (el) {
    el.addEventListener('click', closeMobileMenu);
  });

  // Close mobile menu when clicking outside the nav
  document.addEventListener('click', function (e) {
    if (mobileMenu.classList.contains('open') && !e.target.closest('.nav')) {
      closeMobileMenu();
    }
  });

  // Close mobile menu on Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      closeMobileMenu();
    }
  });


  /* ── NAV SCROLL SHADOW ── */
  window.addEventListener('scroll', function () {
    if (window.scrollY > 8) {
      navEl.style.boxShadow = '0 4px 16px rgba(15,28,46,0.06)';
    } else {
      navEl.style.boxShadow = 'none';
    }
  }, { passive: true });


  /* ── FAQ ACCORDION ── */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var q = item.querySelector('.faq-q');
    var a = item.querySelector('.faq-a');

    // Make FAQ questions keyboard-accessible
    q.setAttribute('role', 'button');
    q.setAttribute('tabindex', '0');
    q.setAttribute('aria-expanded', 'false');

    function toggleFaq() {
      var isOpen = item.classList.contains('open');

      // Close all other open FAQ items
      document.querySelectorAll('.faq-item.open').forEach(function (openItem) {
        openItem.classList.remove('open');
        openItem.querySelector('.faq-a').style.maxHeight = null;
        openItem.querySelector('.faq-q').setAttribute('aria-expanded', 'false');
      });

      // Toggle current item
      if (!isOpen) {
        item.classList.add('open');
        a.style.maxHeight = a.scrollHeight + 'px';
        q.setAttribute('aria-expanded', 'true');
      }
    }

    q.addEventListener('click', toggleFaq);
    q.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleFaq();
      }
    });
  });


  /* ── BENEFITS TABS ── */
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Deactivate all tabs
      document.querySelectorAll('.tab-btn').forEach(function (b) {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });

      // Hide all panels
      document.querySelectorAll('.tab-panel').forEach(function (p) {
        p.classList.remove('active');
      });

      // Activate clicked tab and its panel
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      var panel = document.querySelector('.tab-panel[data-panel="' + btn.dataset.tab + '"]');
      if (panel) {
        panel.classList.add('active');
      }
    });
  });


  /* ── SCROLL REVEAL (IntersectionObserver) ── */
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if ('IntersectionObserver' in window && !reduceMotion) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -40px 0px'
    });

    document.querySelectorAll('.reveal').forEach(function (el) {
      revealObserver.observe(el);
    });
  } else {
    // Show all elements immediately if reduced motion is preferred
    // or if IntersectionObserver is not supported
    document.querySelectorAll('.reveal').forEach(function (el) {
      el.classList.add('in');
    });
  }


  /* ── SMOOTH SCROLL FOR ANCHOR LINKS ── */
  document.querySelectorAll('a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var targetId = this.getAttribute('href');
      if (targetId === '#') return;

      var targetEl = document.querySelector(targetId);
      if (targetEl) {
        e.preventDefault();
        var navHeight = navEl.offsetHeight;
        var targetPosition = targetEl.getBoundingClientRect().top + window.pageYOffset - navHeight - 12;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });

        // Update URL hash without jumping
        if (history.pushState) {
          history.pushState(null, null, targetId);
        }
      }
    });
  });


  /* ── ACTIVE NAV LINK HIGHLIGHTING ── */
  var sections = document.querySelectorAll('section[id]');
  var navLinks = document.querySelectorAll('.nav-links a[href^="#"]');

  if (sections.length && navLinks.length) {
    var activeLinkObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          var id = entry.target.getAttribute('id');
          navLinks.forEach(function (link) {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + id) {
              link.classList.add('active');
            }
          });
        }
      });
    }, {
      threshold: 0.3,
      rootMargin: '-80px 0px -50% 0px'
    });

    sections.forEach(function (section) {
      activeLinkObserver.observe(section);
    });
  }

})();
