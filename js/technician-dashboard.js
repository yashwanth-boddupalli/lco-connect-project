/* ============================================
   LCO CONNECT — Technician Dashboard Logic
   Phase 10: Technician Management & Portal
   ============================================ */

(function () {
  'use strict';

  var sb = null;
  var currentUser = null;
  var currentProfile = null;
  var techProfile = null;
  var lcoInfo = null;

  var allRequests = [];
  var currentSearchTerm = '';
  var currentStatusFilter = 'ALL';

  /* ══════════════════════════════════════════════
     DOM CONTENT LOADED INITIALIZATION
     ══════════════════════════════════════════════ */

  document.addEventListener('DOMContentLoaded', function () {
    initDashboard();
  });

  async function initDashboard() {
    sb = LCOAuth.getClient();

    try {
      // 1. Require authenticated session with TECHNICIAN role & ACTIVE status
      var authData = await LCOAuth.requireRole('TECHNICIAN', 'ACTIVE');
      if (!authData) return; // LCOAuth handles redirect to login

      currentUser = authData.session.user;
      currentProfile = authData.profile;

      // 2. Load technician profile from database (linked by user_id)
      var { data: techData, error: techErr } = await sb
        .from('technicians')
        .select('*, lco_applications(business_name, owner_name, phone)')
        .eq('user_id', currentUser.id)
        .eq('status', 'ACTIVE')
        .single();

      if (techErr || !techData) {
        console.error('Technician record fetch error:', techErr);
        showToast('Technician profile not found or inactive. Please contact your LCO Admin.', 'error');
        setTimeout(async function () {
          await LCOAuth.signOut();
          LCOAuth.redirectToLogin();
        }, 2000);
        return;
      }

      techProfile = techData;
      lcoInfo = techData.lco_applications || null;

      // 3. Render Profile & Header Info
      renderHeaderAndSidebarInfo();
      renderProfileView();

      // 4. Set up UI event listeners
      setupNavigation();
      setupMobileNav();
      setupSearchAndFilters();
      setupLogout();
      setupDetailModal();
      setupNotificationCenterListeners(); // Phase 11 Batch 1

      // 5. Load data
      await loadRequests();
      await loadNotifications();

      // 6. Hide loading screen, reveal dashboard
      var loadingScreen = document.getElementById('techLoadingScreen');
      var container = document.getElementById('techDashboardContainer');
      if (loadingScreen) loadingScreen.style.display = 'none';
      if (container) container.style.display = 'block';

    } catch (err) {
      console.error('Technician dashboard init error:', err);
      // Never strand the user on the loading screen: hide it and show a
      // fatal error state with a way back.
      var failLoading = document.getElementById('techLoadingScreen');
      var failContainer = document.getElementById('techDashboardContainer');
      if (failLoading) failLoading.style.display = 'none';
      if (failContainer) {
        failContainer.style.display = 'block';
        failContainer.innerHTML = '<div class="lco-empty" style="padding:64px 24px; text-align:center;"><div class="lco-empty-icon">⚠️</div><h3>Something went wrong</h3><p>The dashboard could not be loaded. Please try again.</p><button class="lco-quick-btn primary" style="margin-top:12px;" onclick="location.reload()">Reload</button></div>';
      }
      showToast('Error initializing dashboard. Please refresh.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     HEADER & SIDEBAR DISPLAY
     ══════════════════════════════════════════════ */

  function renderHeaderAndSidebarInfo() {
    var nameEl = document.getElementById('techHeaderName');
    var idEl = document.getElementById('techHeaderId');
    var subEl = document.getElementById('techOverviewSub');

    if (nameEl) nameEl.textContent = techProfile.full_name || 'Technician';
    if (idEl) idEl.textContent = techProfile.technician_id || '';
    if (subEl) {
      subEl.textContent = 'Welcome back, ' + (techProfile.full_name || 'Technician') + '! Manage your assigned field service tickets.';
    }
  }


  /* ══════════════════════════════════════════════
     NAVIGATION & VIEW SWITCHING
     ══════════════════════════════════════════════ */

  function setupNavigation() {
    var navItems = document.querySelectorAll('.tech-nav-item');
    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        var viewName = item.dataset.view;
        switchView(viewName);
        closeMobileSidebar();
      });
    });
  }

  function switchView(viewName) {
    var views = document.querySelectorAll('.tech-view');
    var navItems = document.querySelectorAll('.tech-nav-item');

    views.forEach(function (v) { v.classList.remove('active'); });
    navItems.forEach(function (n) { n.classList.remove('active'); });

    var targetView = document.getElementById('view-' + viewName);
    var targetNav = document.querySelector('.tech-nav-item[data-view="' + viewName + '"]');

    if (targetView) targetView.classList.add('active');
    if (targetNav) targetNav.classList.add('active');

    // Trigger re-render if switching to specific view
    if (viewName === 'requests') {
      renderRequestsTable();
    } else if (viewName === 'notifications') {
      loadNotifications();
    }
  }

  // Global helper for card clicks
  window.switchReqFilter = function (status) {
    switchView('requests');
    var statusBtns = document.querySelectorAll('#techReqStatusFilterGroup .lco-filter-btn');
    statusBtns.forEach(function (b) {
      if (b.dataset.status === status) b.click();
    });
  };

  // Exported for inline onclick handlers rendered inside the ticket modal
  // (the script runs inside an IIFE, so these would otherwise be undefined globally)
  window.closeRequestModal = closeRequestModal;
  window.loadNotifications = loadNotifications;


  /* ══════════════════════════════════════════════
     MOBILE NAV SIDEBAR
     ══════════════════════════════════════════════ */

  function setupMobileNav() {
    var toggleBtn = document.getElementById('techMobileNavToggle');
    var sidebar = document.getElementById('techSidebar');
    var overlay = document.getElementById('techSidebarOverlay');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        if (sidebar) sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('visible');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', closeMobileSidebar);
    }
  }

  function closeMobileSidebar() {
    var sidebar = document.getElementById('techSidebar');
    var overlay = document.getElementById('techSidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }


  /* ══════════════════════════════════════════════
     LOAD ASSIGNED SERVICE REQUESTS
     ══════════════════════════════════════════════ */

  async function loadRequests() {
    try {
      // Query assigned service requests — RLS policy ensures tenant & tech isolation
      var { data, error } = await sb
        .from('service_requests')
        .select('*, customers(full_name, phone, address, city, pincode)')
        .eq('assigned_technician_id', techProfile.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      allRequests = data || [];

      // Calculate and update stats
      calculateStats();

      // Render tables
      renderOverviewTable();
      renderRequestsTable();

      // Update nav count badge
      var badge = document.getElementById('techRequestsCount');
      if (badge) {
        var openCount = allRequests.filter(function (r) { return r.status === 'OPEN' || r.status === 'IN_PROGRESS'; }).length;
        badge.textContent = openCount;
        badge.style.display = openCount > 0 ? '' : 'none';
      }

    } catch (err) {
      console.error('Load assigned requests error:', err);
      showToast('Failed to load assigned service requests.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     DASHBOARD STATISTICS
     ══════════════════════════════════════════════ */

  function calculateStats() {
    var total = allRequests.length;
    var openCount = allRequests.filter(function (r) { return r.status === 'OPEN'; }).length;
    var inProgressCount = allRequests.filter(function (r) { return r.status === 'IN_PROGRESS'; }).length;

    // Resolved today calculation — only a real resolved_at dated today
    // counts; no updated_at/created_at fallbacks, no dateless tickets.
    var todayStr = localDateStr();
    var resolvedTodayCount = allRequests.filter(function (r) {
      if (r.status !== 'RESOLVED') return false;
      if (!r.resolved_at) return false;
      return localDateStr(new Date(r.resolved_at)) === todayStr;
    }).length;

    document.getElementById('statTotalAssigned').textContent = total;
    document.getElementById('statOpen').textContent = openCount;
    document.getElementById('statInProgress').textContent = inProgressCount;
    document.getElementById('statResolvedToday').textContent = resolvedTodayCount;
  }


  /* ══════════════════════════════════════════════
     SEARCH & FILTER LOGIC
     ══════════════════════════════════════════════ */

  function setupSearchAndFilters() {
    var searchInput = document.getElementById('techReqSearchInput');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentSearchTerm = searchInput.value.trim().toLowerCase();
          renderRequestsTable();
        }, 250);
      });
    }

    var filterGroup = document.getElementById('techReqStatusFilterGroup');
    if (filterGroup) {
      filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentStatusFilter = btn.dataset.status;
          filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderRequestsTable();
        });
      });
    }
  }

  function getFilteredRequests() {
    return allRequests.filter(function (req) {
      // 1. Status Filter
      if (currentStatusFilter !== 'ALL' && req.status !== currentStatusFilter) {
        return false;
      }

      // 2. Search Term Filter
      if (currentSearchTerm) {
        var custName = req.customers ? req.customers.full_name : '';
        var custPhone = req.customers ? req.customers.phone : '';
        var custAddr = req.customers ? req.customers.address : '';
        var haystack = [
          req.request_id,
          custName,
          custPhone,
          custAddr,
          req.category,
          req.subject,
          req.description,
          req.technician_notes,
          req.resolution_notes
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.indexOf(currentSearchTerm) !== -1;
      }

      return true;
    });
  }


  /* ══════════════════════════════════════════════
     RENDER TABLES
     ══════════════════════════════════════════════ */

  function renderOverviewTable() {
    var tbody = document.getElementById('techOverviewTableBody');
    if (!tbody) return;

    var recentList = allRequests.slice(0, 5); // top 5 recent tickets

    if (recentList.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="lco-empty"><div class="lco-empty-icon">🛠️</div><h3>No assigned requests</h3><p>You have no active or historical tickets assigned.</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = recentList.map(function (req) {
      var custName = req.customers ? req.customers.full_name : 'Customer';
      var custPhone = req.customers ? req.customers.phone : '—';
      var custAddr = req.customers ? (req.customers.address || req.customers.city || '') : '';

      return '<tr>' +
        '<td><strong class="mono">' + esc(req.request_id) + '</strong></td>' +
        '<td><strong>' + esc(custName) + '</strong></td>' +
        '<td><div>' + esc(custPhone) + '</div><div style="font-size:12px; color:var(--slate);">' + esc(custAddr) + '</div></td>' +
        '<td>' + esc(formatCategory(req.category)) + '</td>' +
        '<td>' + renderPriorityBadge(req.priority) + '</td>' +
        '<td>' + renderStatusBadge(req.status) + '</td>' +
        '<td><button class="lco-plan-btn primary" onclick="openRequestModalById(\'' + req.id + '\')">Manage Ticket</button></td>' +
        '</tr>';
    }).join('');
  }

  function renderRequestsTable() {
    var tbody = document.getElementById('techRequestsTableBody');
    if (!tbody) return;

    var filtered = getFilteredRequests();

    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="lco-empty"><div class="lco-empty-icon">🔍</div><h3>No matching requests</h3><p>Try adjusting your search query or status filter.</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (req) {
      var custName = req.customers ? req.customers.full_name : 'Customer';
      var custPhone = req.customers ? req.customers.phone : '—';
      var custAddr = req.customers ? (req.customers.address || '') : '';

      return '<tr>' +
        '<td><strong class="mono">' + esc(req.request_id) + '</strong></td>' +
        '<td><strong>' + esc(custName) + '</strong></td>' +
        '<td><div>' + esc(custPhone) + '</div><div style="font-size:12px; color:var(--slate); max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' + esc(custAddr) + '</div></td>' +
        '<td>' + esc(formatCategory(req.category)) + '</td>' +
        '<td>' + renderPriorityBadge(req.priority) + '</td>' +
        '<td>' + renderStatusBadge(req.status) + '</td>' +
        '<td>' + formatDateShort(req.created_at) + '</td>' +
        '<td><button class="lco-plan-btn primary" onclick="openRequestModalById(\'' + req.id + '\')">View Details</button></td>' +
        '</tr>';
    }).join('');
  }


  /* ══════════════════════════════════════════════
     REQUEST DETAIL MODAL & WORK ACTIONS
     ══════════════════════════════════════════════ */

  function setupDetailModal() {
    var modal = document.getElementById('requestDetailModal');
    if (!modal) return;

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        closeRequestModal();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modal.classList.contains('visible')) {
        closeRequestModal();
      }
    });
  }

  window.openRequestModalById = function (reqDbId) {
    var req = allRequests.find(function (r) { return r.id === reqDbId; });
    if (!req) {
      showToast('Request record not found.', 'error');
      return;
    }
    openRequestModal(req);
  };

  function openRequestModal(req) {
    var modal = document.getElementById('requestDetailModal');
    if (!modal) return;

    document.getElementById('modalReqDbId').value = req.id;
    document.getElementById('modalReqId').textContent = req.request_id;
    document.getElementById('modalServiceCategory').textContent = formatCategory(req.category);

    var custName = req.customers ? req.customers.full_name : 'Customer';
    var custPhone = req.customers ? req.customers.phone : '—';
    var custAddr = req.customers ? [req.customers.address, req.customers.city, req.customers.pincode].filter(Boolean).join(', ') : '';

    document.getElementById('modalCustName').textContent = custName;
    document.getElementById('modalCustPhone').textContent = custPhone;
    document.getElementById('modalCustAddress').textContent = custAddr || 'No address registered';

    // CT-M6: a null customers embed is a data-access problem, not a
    // customer with no contact details — say so explicitly instead of
    // letting the placeholders above read as real missing data.
    var custUnavailableEl = document.getElementById('modalCustUnavailable');
    if (custUnavailableEl) custUnavailableEl.style.display = req.customers ? 'none' : '';

    document.getElementById('modalSubject').textContent = req.subject || '—';
    document.getElementById('modalCustomerDescription').textContent = req.description || 'No description provided by customer.';
    document.getElementById('modalCreatedDate').textContent = 'Raised on: ' + formatDateFull(req.created_at);

    // Show the resolution timestamp when there is one — without it the
    // "Resolved Today" count can never be checked against the ticket.
    var resolvedEl = document.getElementById('modalResolvedDate');
    if (resolvedEl) {
      if (req.status === 'RESOLVED' && req.resolved_at) {
        resolvedEl.textContent = 'Resolved on: ' + formatDateFull(req.resolved_at);
        resolvedEl.style.display = '';
      } else {
        resolvedEl.style.display = 'none';
      }
    }

    // Badges
    var priorityBadge = document.getElementById('modalPriorityBadge');
    var statusBadge = document.getElementById('modalStatusBadge');
    if (priorityBadge) priorityBadge.outerHTML = renderPriorityBadge(req.priority, 'modalPriorityBadge');
    if (statusBadge) statusBadge.outerHTML = renderStatusBadge(req.status, 'modalStatusBadge');

    // Field notes & Resolution notes inputs
    var techNotesInput = document.getElementById('modalTechNotes');
    var resNotesInput = document.getElementById('modalResolutionNotes');
    var resGroup = document.getElementById('modalResolutionNotesGroup');
    var resErr = document.getElementById('modalResolutionNotes-error');

    if (resErr) resErr.classList.remove('visible');

    if (techNotesInput) {
      techNotesInput.value = req.technician_notes || '';
      techNotesInput.readOnly = (req.status === 'RESOLVED' || req.status === 'CLOSED' || req.status === 'CANCELLED');
    }

    if (resNotesInput) {
      resNotesInput.value = req.resolution_notes || '';
      resNotesInput.readOnly = (req.status === 'RESOLVED' || req.status === 'CLOSED' || req.status === 'CANCELLED');
    }

    if (resGroup) {
      // Resolution notes group shown when IN_PROGRESS or RESOLVED
      resGroup.style.display = (req.status === 'IN_PROGRESS' || req.status === 'RESOLVED') ? 'block' : 'none';
    }

    // Render Action Buttons based on current status
    renderModalActions(req);

    modal.classList.add('visible');
  }

  function closeRequestModal() {
    var modal = document.getElementById('requestDetailModal');
    if (modal) modal.classList.remove('visible');
  }

  function renderModalActions(req) {
    var container = document.getElementById('modalActions');
    if (!container) return;

    var status = req.status || 'OPEN';

    if (status === 'OPEN') {
      container.innerHTML =
        '<button type="button" class="tech-btn secondary" onclick="closeRequestModal()">Cancel</button>' +
        '<button type="button" class="tech-btn primary" id="btnStartWork">▶ Start Work</button>';

      document.getElementById('btnStartWork').addEventListener('click', function () {
        handleStartWork(req.id);
      });

    } else if (status === 'IN_PROGRESS') {
      container.innerHTML =
        '<button type="button" class="tech-btn secondary" onclick="closeRequestModal()">Close Window</button>' +
        '<button type="button" class="tech-btn secondary" id="btnUpdateNotes">📝 Update Notes</button>' +
        '<button type="button" class="tech-btn success" id="btnMarkResolved">✓ Mark Resolved</button>';

      document.getElementById('btnUpdateNotes').addEventListener('click', function () {
        handleUpdateNotes(req.id);
      });

      document.getElementById('btnMarkResolved').addEventListener('click', function () {
        handleMarkResolved(req.id);
      });

    } else {
      // RESOLVED, CLOSED, or CANCELLED — Read-only state
      container.innerHTML =
        '<div class="tech-read-only-notice">✓ Ticket is ' + status + '. Further edits are locked.</div>' +
        '<button type="button" class="tech-btn secondary" onclick="closeRequestModal()">Close</button>';
    }
  }


  /* ══════════════════════════════════════════════
     ACTION 1: START WORK (OPEN -> IN_PROGRESS)
     ══════════════════════════════════════════════ */

  async function handleStartWork(reqId) {
    var techNotes = (document.getElementById('modalTechNotes').value || '').trim();
    var btn = document.getElementById('btnStartWork');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="lco-spinner"></span> Starting…';
    }

    try {
      // Update only permitted technician fields
      var { error } = await sb
        .from('service_requests')
        .update({
          status: 'IN_PROGRESS',
          technician_notes: techNotes || null
        })
        .eq('id', reqId)
        .eq('assigned_technician_id', techProfile.id);

      if (error) throw error;

      showToast('Work started on service request!', 'success');
      closeRequestModal();

      // Reload requests & refresh stats
      await loadRequests();

    } catch (err) {
      console.error('Start work error:', err);
      showToast(err.message || 'Failed to start work. Please try again.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '▶ Start Work';
      }
    }
  }


  /* ══════════════════════════════════════════════
     ACTION 2: UPDATE NOTES (IN_PROGRESS)
     ══════════════════════════════════════════════ */

  async function handleUpdateNotes(reqId) {
    var techNotes = (document.getElementById('modalTechNotes').value || '').trim();
    var resNotes = (document.getElementById('modalResolutionNotes').value || '').trim();
    var btn = document.getElementById('btnUpdateNotes');

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="lco-spinner"></span> Updating…';
    }

    try {
      var { error } = await sb
        .from('service_requests')
        .update({
          technician_notes: techNotes || null,
          resolution_notes: resNotes || null
        })
        .eq('id', reqId)
        .eq('assigned_technician_id', techProfile.id);

      if (error) throw error;

      showToast('Technician notes updated successfully!', 'success');
      closeRequestModal();
      await loadRequests();

    } catch (err) {
      console.error('Update notes error:', err);
      showToast(err.message || 'Failed to update notes.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📝 Update Notes';
      }
    }
  }


  /* ══════════════════════════════════════════════
     ACTION 3: MARK RESOLVED (IN_PROGRESS -> RESOLVED)
     ══════════════════════════════════════════════ */

  async function handleMarkResolved(reqId) {
    var techNotes = (document.getElementById('modalTechNotes').value || '').trim();
    var resNotes = (document.getElementById('modalResolutionNotes').value || '').trim();
    var errEl = document.getElementById('modalResolutionNotes-error');

    // Validation: Resolution notes are REQUIRED before resolving ticket
    if (!resNotes) {
      if (errEl) errEl.classList.add('visible');
      document.getElementById('modalResolutionNotes').focus();
      return;
    } else {
      if (errEl) errEl.classList.remove('visible');
    }

    var btn = document.getElementById('btnMarkResolved');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="lco-spinner"></span> Resolving…';
    }

    try {
      var nowIso = new Date().toISOString();

      var { error } = await sb
        .from('service_requests')
        .update({
          status: 'RESOLVED',
          resolution_notes: resNotes,
          technician_notes: techNotes || null,
          resolved_at: nowIso
        })
        .eq('id', reqId)
        .eq('assigned_technician_id', techProfile.id);

      if (error) throw error;

      showToast('Ticket marked as RESOLVED! Notification sent to operator and customer.', 'success');
      closeRequestModal();
      await loadRequests();

    } catch (err) {
      console.error('Mark resolved error:', err);
      showToast(err.message || 'Failed to resolve ticket.', 'error');
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ Mark Resolved';
      }
    }
  }


  /* ══════════════════════════════════════════════
     NOTIFICATIONS
     ══════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════
     NOTIFICATIONS LOGIC (Phase 11 Batch 1)
     ══════════════════════════════════════════════ */

  var techNotifCategoryFilter = 'ALL';
  var techNotifStatusFilter = 'ALL';
  var techNotifLoadId = 0;

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    var now = new Date();
    var diffMs = now - d;
    var diffSec = Math.floor(diffMs / 1000);
    var diffMin = Math.floor(diffSec / 60);
    var diffHr = Math.floor(diffMin / 60);
    var diffDay = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    if (diffHr < 24) return diffHr + 'h ago';
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return diffDay + 'd ago';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function getTechCategoryMeta(cat) {
    switch (cat) {
      case 'SERVICE_REQUEST': return { label: 'Field Ticket', icon: '🛠️' };
      case 'ACCOUNT': return { label: 'Account', icon: '👤' };
      case 'SYSTEM': return { label: 'System', icon: '🔧' };
      case 'ANNOUNCEMENT': return { label: 'Announcement', icon: '📢' };
      default: return { label: 'General', icon: '💬' };
    }
  }

  function setupNotificationCenterListeners() {
    var catGroup = document.getElementById('techNotifCategoryFilter');
    if (catGroup) {
      catGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          catGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          techNotifCategoryFilter = btn.dataset.cat || 'ALL';
          loadNotifications();
        });
      });
    }

    var statusGroup = document.getElementById('techNotifStatusFilter');
    if (statusGroup) {
      statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          techNotifStatusFilter = btn.dataset.status || 'ALL';
          loadNotifications();
        });
      });
    }

    var markAllBtn = document.getElementById('techMarkAllReadBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', markAllNotificationsRead);
    }

    var togglePrefBtn = document.getElementById('techTogglePrefBtn');
    var closePrefBtn = document.getElementById('techClosePrefBtn');
    var prefCard = document.getElementById('techNotifPrefCard');
    if (togglePrefBtn && prefCard) {
      togglePrefBtn.addEventListener('click', function() {
        var isHidden = prefCard.style.display === 'none';
        if (isHidden) {
          // The card lives inside the Activity Feed tab pane, so opening
          // it from the Communication History tab showed nothing — switch
          // to the feed tab first so the card is actually visible.
          var feedPane = document.getElementById('techNotifTabFeedContainer');
          var feedTabBtn = document.querySelector('[data-tech-notif-tab="feed"]');
          if (feedPane && feedTabBtn && feedPane.style.display === 'none') feedTabBtn.click();
          prefCard.style.display = 'block';
          loadNotificationPreferences();
        } else {
          prefCard.style.display = 'none';
        }
      });
    }
    if (closePrefBtn && prefCard) {
      closePrefBtn.addEventListener('click', function() {
        prefCard.style.display = 'none';
      });
    }

    var savePrefBtn = document.getElementById('techSavePrefBtn');
    if (savePrefBtn) {
      savePrefBtn.addEventListener('click', saveNotificationPreferences);
    }

    setupTechnicianNotifSubTabs();
  }

  var activeTechNotifSubTab = 'feed';

  function setupTechnicianNotifSubTabs() {
    var subTabBtns = document.querySelectorAll('.lco-sub-tab-btn[data-tech-notif-tab]');
    subTabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        subTabBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeTechNotifSubTab = btn.dataset.techNotifTab;

        var feedWrap = document.getElementById('techNotifTabFeedContainer');
        var historyWrap = document.getElementById('techNotifTabHistoryContainer');

        if (feedWrap) feedWrap.style.display = (activeTechNotifSubTab === 'feed') ? 'block' : 'none';
        if (historyWrap) historyWrap.style.display = (activeTechNotifSubTab === 'history') ? 'block' : 'none';

        if (activeTechNotifSubTab === 'feed') {
          loadNotifications();
        } else if (activeTechNotifSubTab === 'history') {
          loadTechnicianCommunicationHistory();
        }
      });
    });

    var catSel = document.getElementById('techCommCategorySelect');
    if (catSel) {
      catSel.addEventListener('change', function() {
        if (activeTechNotifSubTab === 'history') loadTechnicianCommunicationHistory();
      });
    }

    var searchInput = document.getElementById('techCommSearchInput');
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          if (activeTechNotifSubTab === 'history') loadTechnicianCommunicationHistory();
        }, 300);
      });
    }
  }

  async function loadTechnicianCommunicationHistory() {
    var body = document.getElementById('techCommHistoryBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--slate);">Loading communication history…</td></tr>';

    var category = document.getElementById('techCommCategorySelect') ? document.getElementById('techCommCategorySelect').value : 'ALL';
    var search = document.getElementById('techCommSearchInput') ? document.getElementById('techCommSearchInput').value.trim() : '';

    try {
      var { data, error } = await sb.rpc('get_technician_communication_history', {
        p_category: category,
        p_search: search || null
      });
      if (error) throw error;

      var events = data || [];
      if (events.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--slate);">No communication history records found.</td></tr>';
        return;
      }

      body.innerHTML = events.map(function(ev) {
        var catBadge = renderCategoryBadge(ev.category);
        var channelBadge = renderChannelBadge(ev.channel);
        var statusBadge = renderCommStatusBadge(ev.status_label);

        return '<tr>' +
          '<td><strong style="color:var(--ink);">' + esc(ev.title) + '</strong></td>' +
          '<td>' + catBadge + '</td>' +
          '<td><div style="font-size:13px; color:#475569; max-width:320px;">' + esc(ev.summary) + '</div></td>' +
          '<td>' + channelBadge + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + formatDateFull(ev.created_at) + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      console.error('Load technician communication history error:', e);
      body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#DC2626;">Failed to load communication history.</td></tr>';
    }
  }

  function renderCategoryBadge(cat) {
    var cls = 'default';
    if (cat === 'ACCOUNT') cls = 'account';
    else if (cat === 'SERVICE_REQUEST') cls = 'service';
    else if (cat === 'SYSTEM') cls = 'system';
    return '<span class="lco-notif-cat-badge ' + cls + '">' + esc(getTechCategoryMeta(cat).label) + '</span>';
  }

  function renderChannelBadge(ch) {
    var bg = '#E2E8F0', color = '#334155';
    if (ch === 'In-App Feed') { bg = '#E0F2FE'; color = '#0369A1'; }
    else if (ch === 'Email Invite (Sent/Attempted)') { bg = '#FEF3C7'; color = '#92400E'; }
    return '<span style="display:inline-block; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; background:' + bg + '; color:' + color + ';">' + esc(ch) + '</span>';
  }

  function renderCommStatusBadge(status) {
    var bg = '#F1F5F9', color = '#475569';
    var st = (status || '').toUpperCase();
    if (st === 'READ' || st === 'ACTIVATED' || st === 'ACTIVE') { bg = '#DCFCE7'; color = '#166534'; }
    else if (st === 'UNREAD' || st === 'INVITED' || st === 'PENDING') { bg = '#FEF9C3'; color = '#854D0E'; }
    else if (st === 'FAILED' || st === 'EXPIRED' || st === 'INACTIVE') { bg = '#FEE2E2'; color = '#991B1B'; }
    return '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; background:' + bg + '; color:' + color + ';">' + esc(status || '—') + '</span>';
  }

  async function loadNotifications() {
    var container = document.getElementById('techNotifList');
    if (!container) return;

    // Rapid filter clicks fire overlapping loads; only the newest load may
    // render, otherwise a slower earlier request overwrites the list with
    // the previous filter's rows (stale-render race).
    var myLoadId = ++techNotifLoadId;

    try {
      var query = sb.from('notifications')
        .select('*')
        .eq('lco_id', techProfile.lco_id)
        .eq('technician_id', techProfile.id)
        .eq('recipient_role', 'TECHNICIAN');

      if (techNotifCategoryFilter !== 'ALL') {
        query = query.eq('category', techNotifCategoryFilter);
      }
      if (techNotifStatusFilter === 'UNREAD') {
        query = query.eq('is_read', false);
      } else if (techNotifStatusFilter === 'READ') {
        query = query.eq('is_read', true);
      }

      var { data, error } = await query.order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      if (myLoadId !== techNotifLoadId) return;

      var notifications = data || [];

      // Update total unread badge
      var { count: unreadCount } = await sb.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('lco_id', techProfile.lco_id)
        .eq('technician_id', techProfile.id)
        .eq('recipient_role', 'TECHNICIAN')
        .eq('is_read', false);

      if (myLoadId !== techNotifLoadId) return;

      var badge = document.getElementById('techNotifCount');
      if (badge) {
        badge.textContent = unreadCount || 0;
        badge.style.display = (unreadCount && unreadCount > 0) ? '' : 'none';
      }

      if (notifications.length === 0) {
        container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">🔔</div><h3>No notifications</h3><p>You have no recent messages.</p></div>';
        return;
      }

      container.innerHTML = notifications.map(function (n) {
        var catMeta = getTechCategoryMeta(n.category);
        return '<div class="lco-notif-item' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
          '<div class="lco-notif-dot' + (n.is_read ? ' read' : '') + '"></div>' +
          '<span class="lco-notif-icon">' + catMeta.icon + '</span>' +
          '<div class="lco-notif-body">' +
          '<div class="lco-notif-title">' + esc(n.title) +
          '<span class="lco-notif-cat-badge cat-' + (n.category || 'SERVICE_REQUEST') + '">' + esc(catMeta.label) + '</span>' +
          '</div>' +
          '<div class="lco-notif-message">' + esc(n.message) + '</div>' +
          '<div class="lco-notif-time">' + formatTimeAgo(n.created_at) + ' • ' + formatTimeOnly(n.created_at) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      container.querySelectorAll('.lco-notif-item.unread').forEach(function (item) {
        item.addEventListener('click', function () {
          // Optimistic visual update; markNotificationRead rolls it
          // back if the server update fails.
          item.classList.remove('unread');
          var dot = item.querySelector('.lco-notif-dot');
          if (dot) dot.classList.add('read');
          markNotificationRead(item.dataset.id, item);
        });
      });

    } catch (err) {
      // A stale failing load must not overwrite a newer successful list.
      if (myLoadId !== techNotifLoadId) return;
      console.error('Load technician notifications error:', err);
      container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">⚠️</div><h3>Unable to load notifications</h3><button class="lco-quick-btn secondary" style="margin-top:12px;" onclick="loadNotifications()">Retry</button></div>';
    }
  }

  async function markNotificationRead(notifId, itemEl) {
    function rollback() {
      if (!itemEl) return;
      itemEl.classList.add('unread');
      var dot = itemEl.querySelector('.lco-notif-dot');
      if (dot) dot.classList.remove('read');
    }

    try {
      var { error } = await sb.from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
        .eq('technician_id', techProfile.id)
        .eq('recipient_role', 'TECHNICIAN');

      if (error) throw error;

      var badge = document.getElementById('techNotifCount');
      if (badge) {
        var current = parseInt(badge.textContent) || 0;
        var newCount = Math.max(0, current - 1);
        badge.textContent = newCount;
        badge.style.display = newCount > 0 ? '' : 'none';
      }
    } catch (e) {
      console.error('Mark technician notification read error:', e);
      rollback();
    }
  }

  async function markAllNotificationsRead() {
    try {
      var { error } = await sb.from('notifications')
        .update({ is_read: true })
        .eq('lco_id', techProfile.lco_id)
        .eq('technician_id', techProfile.id)
        .eq('recipient_role', 'TECHNICIAN')
        .eq('is_read', false);

      if (error) throw error;
      showToast('All notifications marked as read', 'success');
      loadNotifications();
    } catch (e) {
      console.error('Technician mark all read error:', e);
      showToast('Failed to mark all as read', 'error');
    }
  }

  async function loadNotificationPreferences() {
    var form = document.getElementById('techPrefForm');
    if (!form) return;
    form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:var(--slate);">Loading preferences…</div>';

    var savePrefBtn = document.getElementById('techSavePrefBtn');

    try {
      var { data, error } = await sb.rpc('get_my_notification_preferences', { p_role: 'TECHNICIAN' });
      if (error) throw error;

      var prefs = data || [];

      if (prefs.length === 0) {
        form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:var(--slate);">No notification preferences available.</div>';
        if (savePrefBtn) savePrefBtn.disabled = true;
        return;
      }

      if (savePrefBtn) savePrefBtn.disabled = false;
      var categoryDescriptions = {
        'SERVICE_REQUEST': 'Job assignment notifications & field ticket status updates.',
        'ACCOUNT': 'Account credential updates and security alerts.',
        'SYSTEM': 'System maintenance and network outage notices.',
        'ANNOUNCEMENT': 'Broadband operator updates and field operational notices.'
      };

      form.innerHTML = prefs.map(function(pref) {
        var catMeta = getTechCategoryMeta(pref.category);
        var desc = categoryDescriptions[pref.category] || 'Channel preferences for this category.';
        var isMandatory = (pref.category === 'SERVICE_REQUEST' || pref.category === 'ACCOUNT');

        return '<div class="lco-pref-card" data-cat="' + pref.category + '">' +
          '<div class="lco-pref-card-title">' + catMeta.icon + ' ' + esc(catMeta.label) + '</div>' +
          '<div class="lco-pref-card-desc">' + esc(desc) + '</div>' +
          '<div class="lco-pref-channels">' +
            '<div class="lco-pref-channel-row">' +
              '<span>In-App Feed</span>' +
              '<label class="lco-switch">' +
                '<input type="checkbox" class="pref-in-app" ' + (pref.channel_in_app ? 'checked' : '') + (isMandatory ? ' disabled' : '') + '>' +
                '<span class="lco-slider"></span>' +
              '</label>' +
            '</div>' +
            '<div class="lco-pref-channel-row">' +
              '<span>Email Notification</span>' +
              '<label class="lco-switch">' +
                '<input type="checkbox" class="pref-email" ' + (pref.channel_email ? 'checked' : '') + '>' +
                '<span class="lco-slider"></span>' +
              '</label>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      console.error('Load technician preferences error:', e);
      form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:#E74C3C;">Failed to load preferences.</div>';
      if (savePrefBtn) savePrefBtn.disabled = true;
    }
  }

  async function saveNotificationPreferences() {
    // Never "save" an empty set: if preferences failed to load (or
    // rendered no cards) there is nothing valid to submit.
    var prefForm = document.getElementById('techPrefForm');
    var prefCards = prefForm ? prefForm.querySelectorAll('.lco-pref-card') : [];
    if (!prefCards || prefCards.length === 0) {
      showToast("Preferences couldn't be loaded — please reload and try again", 'error');
      return;
    }

    var saveBtn = document.getElementById('techSavePrefBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      var form = document.getElementById('techPrefForm');
      var updatedPrefs = [];
      form.querySelectorAll('.lco-pref-card').forEach(function(card) {
        var cat = card.dataset.cat;
        var inApp = card.querySelector('.pref-in-app').checked;
        var email = card.querySelector('.pref-email').checked;
        updatedPrefs.push({ category: cat, channel_in_app: inApp, channel_email: email });
      });

      var { data, error } = await sb.rpc('save_my_notification_preferences', {
        p_role: 'TECHNICIAN',
        p_preferences: updatedPrefs
      });

      if (error) throw error;
      showToast('Notification preferences saved!', 'success');
      document.getElementById('techNotifPrefCard').style.display = 'none';
    } catch (e) {
      console.error('Save technician preferences error:', e);
      showToast('Failed to save preferences', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Preferences';
      }
    }
  }


  /* ══════════════════════════════════════════════
     PROFILE VIEW
     ══════════════════════════════════════════════ */

  function renderProfileView() {
    var nameEl = document.getElementById('techProfileName');
    var avatarEl = document.getElementById('techProfileAvatar');
    var badgeEl = document.getElementById('techProfileBadge');
    var techGrid = document.getElementById('techProfileDetailsGrid');
    var lcoGrid = document.getElementById('techProfileLcoGrid');

    if (nameEl) nameEl.textContent = techProfile.full_name || 'Technician';

    if (badgeEl) {
      var status = techProfile.status || 'ACTIVE';
      var badgeCls = status === 'ACTIVE' ? 'active' : (status === 'INACTIVE' || status === 'SUSPENDED') ? 'inactive' : 'pending';
      badgeEl.innerHTML = '<span class="lco-badge ' + badgeCls + '">' + esc(status) + '</span>';
    }

    if (avatarEl) {
      var initials = (techProfile.full_name || 'TC').split(' ').map(function (w) { return w.charAt(0); }).join('').substring(0, 2).toUpperCase();
      avatarEl.textContent = initials;
    }

    if (techGrid) {
      techGrid.innerHTML =
        detailField('Technician ID', techProfile.technician_id) +
        detailField('Full Name', techProfile.full_name) +
        detailField('Mobile Phone', techProfile.phone) +
        detailField('Email Address', techProfile.email) +
        detailField('Account Status', techProfile.status) +
        detailField('Invitation Status', techProfile.invitation_status) +
        detailField('Registered Date', formatDateFull(techProfile.created_at));
    }

    if (lcoGrid) {
      var bizName = lcoInfo ? lcoInfo.business_name : 'Local Cable Operator';
      var ownerName = lcoInfo ? lcoInfo.owner_name : '—';
      var lcoPhone = lcoInfo ? lcoInfo.phone : '—';

      lcoGrid.innerHTML =
        detailField('Business / LCO Name', bizName) +
        detailField('Operator Owner', ownerName) +
        detailField('Operator Contact', lcoPhone);
    }
  }


  /* ══════════════════════════════════════════════
     LOGOUT
     ══════════════════════════════════════════════ */

  function setupLogout() {
    var btn = document.getElementById('techLogoutBtn');
    if (btn) {
      btn.addEventListener('click', async function () {
        await LCOAuth.signOut();
        LCOAuth.redirectToLogin();
      });
    }
  }


  /* ══════════════════════════════════════════════
     FORMATTING & UI UTILITIES
     ══════════════════════════════════════════════ */

  function formatCategory(cat) {
    var map = {
      'NO_SIGNAL': 'No Signal / TV Blackout',
      'SLOW_INTERNET': 'Slow Internet Speed',
      'NO_INTERNET': 'No Internet Connection',
      'BILLING_ISSUE': 'Billing / Payment Query',
      'HARDWARE_FAULT': 'Hardware / Box Fault',
      'NEW_CONNECTION': 'New Connection',
      'RELOCATION': 'Relocation',
      'OTHER': 'Other Complaint'
    };
    return map[cat] || cat || 'General Query';
  }

  function renderPriorityBadge(priority, customId) {
    var p = priority || 'MEDIUM';
    var cls = p.toLowerCase();
    var idAttr = customId ? ' id="' + customId + '"' : '';
    return '<span' + idAttr + ' class="lco-badge priority-' + cls + '">' + p + '</span>';
  }

  function renderStatusBadge(status, customId) {
    var s = status || 'OPEN';
    var cls = 'pending';
    if (s === 'OPEN') cls = 'pending';
    else if (s === 'IN_PROGRESS') cls = 'active';
    else if (s === 'RESOLVED') cls = 'active';
    else if (s === 'CLOSED') cls = 'inactive';
    else if (s === 'CANCELLED') cls = 'expired';

    var idAttr = customId ? ' id="' + customId + '"' : '';
    return '<span' + idAttr + ' class="lco-badge ' + cls + '">' + s + '</span>';
  }

  function detailField(label, val, fullWidth) {
    var cls = fullWidth ? ' lco-detail-field full' : ' lco-detail-field';
    return '<div class="' + cls + '">' +
      '<div class="lco-detail-label">' + esc(label) + '</div>' +
      '<div class="lco-detail-value">' + esc(val || '—') + '</div>' +
      '</div>';
  }

  // Date-only 'YYYY-MM-DD' strings must parse as LOCAL dates — new Date(str)
  // parses them as UTC midnight, which renders a day early west of UTC.
  function parseLocalDate(dateStr) {
    if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      var parts = dateStr.split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    }
    return new Date(dateStr);
  }

  function formatDateShort(dateStr) {
    if (!dateStr) return '—';
    var d = parseLocalDate(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '—';
    var d = parseLocalDate(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // Time only — paired with formatTimeAgo in the notification list, where
  // appending formatDateFull repeated the date for anything a week old
  // ("23 Sept 2026 • 23 Sept 2026, 01:03 am").
  function formatTimeOnly(dateStr) {
    if (!dateStr) return '—';
    var d = new Date(dateStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  // Local (IST) calendar date as YYYY-MM-DD. NEVER derive a date-only
  // value from toISOString() - that is UTC, so between 00:00 and 05:30
  // IST it returns yesterday (develop1 fix for the UTC date bugs).
  function localDateStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showToast(message, type) {
    var container = document.getElementById('techToastContainer');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'lco-toast ' + (type || '');

    var icon = '💬';
    if (type === 'error') icon = '⚠️';
    else if (type === 'success') icon = '✓';
    else if (type === 'warning') icon = '⚡';

    toast.innerHTML = '<span class="lco-toast-icon">' + icon + '</span><span>' + esc(message) + '</span>';
    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 4500);
  }

})();

/* ══════════════════════════════════════════════
   MOBILE TABLE LABELS (develop1 fix)
   The responsive CSS turns tables into cards on
   small screens and labels each cell via
   td::before { content: attr(data-label) } — but
   most renderers build <td>s without data-label.
   This stamper copies each table's header text
   onto its cells (by column, colspan-aware) after
   every render, observed via MutationObserver.
   ══════════════════════════════════════════════ */
(function () {
  function stampDataLabels(root) {
    (root || document).querySelectorAll('table').forEach(function (tbl) {
      var heads = Array.prototype.map.call(
        tbl.querySelectorAll('thead th'),
        function (th) { return th.textContent.trim(); }
      );
      if (!heads.length) return;
      tbl.querySelectorAll('tbody tr').forEach(function (tr) {
        var col = 0;
        Array.prototype.forEach.call(tr.children, function (td) {
          var span = td.colSpan || 1;
          if (td.tagName === 'TD' && span === 1 && !td.hasAttribute('data-label') && heads[col]) {
            td.setAttribute('data-label', heads[col]);
          }
          col += span;
        });
      });
    });
  }
  function init() {
    stampDataLabels(document);
    if (window.MutationObserver && document.body) {
      new MutationObserver(function () { stampDataLabels(document); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
