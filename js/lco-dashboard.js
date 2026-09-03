/* ============================================
   LCO CONNECT — LCO Dashboard Logic
   Phase 4: LCO Admin Dashboard
   ============================================
   Follows the same IIFE pattern as super-admin.js.
   Uses LCOAuth shared module for authentication.
   ============================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     SUPABASE CLIENT (from shared auth module)
     ══════════════════════════════════════════════ */

  var sb = LCOAuth.getClient();


  /* ══════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════ */

  var currentUser = null;
  var lcoData = null;       // lco_applications row
  var lcoId = null;         // lco_applications.id (tenant key)
  var currentView = 'overview';
  var allCustomers = [];
  var currentDetailCustomer = null;
  var currentFilter = 'all';
  var currentSearch = '';


  /* ══════════════════════════════════════════════
     AUTH GUARD
     ══════════════════════════════════════════════ */

  async function initAuth() {
    if (!sb) {
      showToast('Connection unavailable. Please refresh.', 'error');
      return;
    }

    try {
      var authData = await LCOAuth.requireRole('LCO_ADMIN', 'ACTIVE');
      if (!authData) return;

      currentUser = {
        id: authData.session.user.id,
        email: authData.profile.email || authData.session.user.email,
        role: authData.profile.role
      };

      // Fetch LCO application data (business info)
      var { data: lco, error: lcoError } = await sb.from('lco_applications')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'APPROVED')
        .limit(1)
        .maybeSingle();

      if (lcoError || !lco) {
        showToast('Unable to load LCO profile. Please contact support.', 'error');
        return;
      }

      lcoData = lco;
      lcoId = lco.id;

      // Show dashboard
      document.getElementById('lcoLoadingScreen').style.display = 'none';
      document.getElementById('lcoDashboardContainer').style.display = 'block';

      // Set header info
      var bizNameEl = document.getElementById('lcoBizName');
      if (bizNameEl) bizNameEl.textContent = lcoData.business_name;

      // Initialize dashboard
      initDashboard();

    } catch (e) {
      console.error('LCO Auth check failed:', e);
      LCOAuth.redirectToLogin();
    }
  }


  /* ══════════════════════════════════════════════
     DASHBOARD INITIALIZATION
     ══════════════════════════════════════════════ */

  function initDashboard() {
    setupNavigation();
    setupLogout();
    setupMobileNav();
    setupSearch();
    setupFilters();
    setupStatCardClicks();
    setupAddCustomerModal();

    // Load data
    loadStats();
    loadCustomers();
    loadNotifications();
  }


  /* ══════════════════════════════════════════════
     NAVIGATION
     ══════════════════════════════════════════════ */

  function setupNavigation() {
    var navItems = document.querySelectorAll('.lco-nav-item[data-view]');
    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        switchView(item.dataset.view);
        closeMobileNav();
      });
    });
  }

  function switchView(viewName) {
    currentView = viewName;

    // Update nav
    document.querySelectorAll('.lco-nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.lco-view').forEach(function (view) {
      view.classList.remove('active');
    });
    var targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Load data for specific views
    if (viewName === 'overview') {
      loadStats();
      loadRecentCustomers();
    } else if (viewName === 'customers') {
      renderCustomersTable();
    } else if (viewName === 'services') {
      renderServicesSummary();
    } else if (viewName === 'notifications') {
      loadNotifications();
    } else if (viewName === 'profile') {
      renderProfile();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  /* ══════════════════════════════════════════════
     MOBILE NAVIGATION
     ══════════════════════════════════════════════ */

  function setupMobileNav() {
    var toggleBtn = document.getElementById('lcoMobileNavToggle');
    var sidebar = document.getElementById('lcoSidebar');
    var overlay = document.getElementById('lcoSidebarOverlay');

    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('visible');
    });

    overlay.addEventListener('click', closeMobileNav);
  }

  function closeMobileNav() {
    document.getElementById('lcoSidebar').classList.remove('open');
    document.getElementById('lcoSidebarOverlay').classList.remove('visible');
  }


  /* ══════════════════════════════════════════════
     LOGOUT
     ══════════════════════════════════════════════ */

  function setupLogout() {
    document.getElementById('lcoLogoutBtn').addEventListener('click', async function () {
      await LCOAuth.signOut();
      LCOAuth.redirectToLogin();
    });
  }


  /* ══════════════════════════════════════════════
     STAT CARD CLICKS
     ══════════════════════════════════════════════ */

  function setupStatCardClicks() {
    document.getElementById('lcoStatTotal').addEventListener('click', function () {
      switchView('customers');
      setFilter('all');
    });
    document.getElementById('lcoStatActive').addEventListener('click', function () {
      switchView('customers');
      setFilter('ACTIVE');
    });
    document.getElementById('lcoStatInactive').addEventListener('click', function () {
      switchView('customers');
      setFilter('INACTIVE');
    });
    document.getElementById('lcoStatServices').addEventListener('click', function () {
      switchView('services');
    });
  }


  /* ══════════════════════════════════════════════
     LOAD STATS
     ══════════════════════════════════════════════ */

  async function loadStats() {
    try {
      var { data, error } = await sb.from('customers')
        .select('service_status')
        .eq('lco_id', lcoId);

      if (error) throw error;

      var total = data.length;
      var active = data.filter(function (c) { return c.service_status === 'ACTIVE'; }).length;
      var inactive = data.filter(function (c) { return c.service_status !== 'ACTIVE'; }).length;

      document.getElementById('lcoStatTotalValue').textContent = total;
      document.getElementById('lcoStatActiveValue').textContent = active;
      document.getElementById('lcoStatInactiveValue').textContent = inactive;
      document.getElementById('lcoStatServicesValue').textContent = active;

    } catch (e) {
      console.error('Load stats error:', e);
      document.getElementById('lcoStatTotalValue').textContent = '—';
      document.getElementById('lcoStatActiveValue').textContent = '—';
      document.getElementById('lcoStatInactiveValue').textContent = '—';
      document.getElementById('lcoStatServicesValue').textContent = '—';
    }
  }


  /* ══════════════════════════════════════════════
     LOAD CUSTOMERS
     ══════════════════════════════════════════════ */

  async function loadCustomers() {
    try {
      var { data, error } = await sb.from('customers')
        .select('*')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      allCustomers = data || [];
      loadRecentCustomers();
      renderCustomersTable();

    } catch (e) {
      console.error('Load customers error:', e);
      showToast('Failed to load customers.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     RECENT CUSTOMERS (Overview)
     ══════════════════════════════════════════════ */

  function loadRecentCustomers() {
    var tbody = document.getElementById('lcoRecentTableBody');
    var recent = allCustomers.slice(0, 5);

    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="lco-empty"><div class="lco-empty-icon">👤</div><h3>No customers yet</h3><p>Add your first customer to get started.</p><button class="lco-quick-btn primary" onclick="document.getElementById(\'addCustomerModal\').classList.add(\'visible\')">+ Add Customer</button></div></td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(function (cust) {
      return buildCustomerRow(cust);
    }).join('');

    attachCustomerRowListeners(tbody);
  }


  /* ══════════════════════════════════════════════
     CUSTOMERS TABLE
     ══════════════════════════════════════════════ */

  function renderCustomersTable() {
    var tbody = document.getElementById('lcoCustomersTableBody');
    var filtered = getFilteredCustomers();

    if (filtered.length === 0) {
      var msg = currentSearch ? 'No customers match your search.' : 'No customers found.';
      tbody.innerHTML = '<tr><td colspan="7"><div class="lco-empty"><div class="lco-empty-icon">🔍</div><h3>' + msg + '</h3>' +
        (currentSearch ? '' : '<button class="lco-quick-btn primary" onclick="document.getElementById(\'addCustomerModal\').classList.add(\'visible\')">+ Add Customer</button>') +
        '</div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (cust) {
      return buildCustomerRow(cust);
    }).join('');

    attachCustomerRowListeners(tbody);
  }

  function buildCustomerRow(cust) {
    var row = '<tr data-id="' + cust.id + '">';
    row += '<td data-label="Customer ID"><span class="lco-cust-id">' + esc(cust.customer_id) + '</span></td>';
    row += '<td data-label="Name"><span class="lco-cust-name">' + esc(cust.full_name) + '</span></td>';
    row += '<td data-label="Phone">' + esc(cust.phone) + '</td>';
    row += '<td data-label="Service">' + renderServiceTag(cust.service_type) + '</td>';
    row += '<td data-label="Status">' + renderStatusBadge(cust.service_status) + '</td>';
    row += '<td data-label="Registered"><span class="lco-date">' + formatDate(cust.created_at) + '</span></td>';
    row += '<td data-label="Action"><button class="lco-view-btn" data-cust-id="' + cust.id + '">View</button></td>';
    row += '</tr>';
    return row;
  }

  function attachCustomerRowListeners(tbody) {
    tbody.querySelectorAll('.lco-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openCustomerDetail(btn.dataset.custId);
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        openCustomerDetail(tr.dataset.id);
      });
    });
  }


  /* ══════════════════════════════════════════════
     SEARCH & FILTER
     ══════════════════════════════════════════════ */

  function setupSearch() {
    var searchInput = document.getElementById('lcoSearchInput');
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        currentSearch = searchInput.value.trim().toLowerCase();
        renderCustomersTable();
      }, 250);
    });
  }

  function setupFilters() {
    var filterGroup = document.getElementById('lcoFilterGroup');
    filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setFilter(btn.dataset.filter);
      });
    });
  }

  function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('#lcoFilterGroup .lco-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderCustomersTable();
  }

  function getFilteredCustomers() {
    return allCustomers.filter(function (cust) {
      if (currentFilter !== 'all' && cust.service_status !== currentFilter) return false;
      if (currentSearch) {
        var haystack = [
          cust.customer_id,
          cust.full_name,
          cust.phone,
          cust.email,
          cust.service_type,
          cust.city
        ].join(' ').toLowerCase();
        return haystack.indexOf(currentSearch) !== -1;
      }
      return true;
    });
  }


  /* ══════════════════════════════════════════════
     CUSTOMER DETAIL VIEW
     ══════════════════════════════════════════════ */

  function openCustomerDetail(custId) {
    var cust = allCustomers.find(function (c) { return c.id === custId; });
    if (!cust) {
      showToast('Customer not found.', 'error');
      return;
    }

    currentDetailCustomer = cust;

    // Switch to detail view
    document.querySelectorAll('.lco-view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-customer-detail').classList.add('active');
    document.querySelectorAll('.lco-nav-item').forEach(function (item) { item.classList.remove('active'); });

    // Header
    document.getElementById('lcoDetailName').textContent = cust.full_name;
    document.getElementById('lcoDetailCustId').textContent = cust.customer_id;
    document.getElementById('lcoDetailStatusBadge').innerHTML = renderStatusBadge(cust.service_status);

    // Personal info
    var personalGrid = document.getElementById('lcoDetailPersonalGrid');
    personalGrid.innerHTML =
      detailField('Customer ID', cust.customer_id) +
      detailField('Full Name', cust.full_name) +
      detailField('Phone', cust.phone) +
      detailField('Email', cust.email) +
      detailField('Address', cust.address, true) +
      detailField('City', cust.city) +
      detailField('State', cust.state) +
      detailField('PIN Code', cust.pincode);

    // Service info
    var serviceGrid = document.getElementById('lcoDetailServiceGrid');
    serviceGrid.innerHTML =
      detailField('Service Type', cust.service_type) +
      detailField('Plan', cust.plan_name) +
      detailField('Service Status', cust.service_status) +
      detailField('Connection Date', cust.connection_date ? formatDate(cust.connection_date) : '—');

    // Account info
    var accountGrid = document.getElementById('lcoDetailAccountGrid');
    accountGrid.innerHTML =
      detailField('Account Status', cust.service_status) +
      detailField('Created', formatDateFull(cust.created_at)) +
      detailField('Last Updated', formatDateFull(cust.updated_at));

    // Notes
    var notesSection = document.getElementById('lcoDetailNotesSection');
    if (cust.notes) {
      notesSection.style.display = 'block';
      document.getElementById('lcoDetailNotes').textContent = cust.notes;
    } else {
      notesSection.style.display = 'none';
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function detailField(label, value, fullWidth) {
    return '<div class="lco-detail-field' + (fullWidth ? ' full-width' : '') + '">' +
      '<div class="lco-detail-label">' + esc(label) + '</div>' +
      '<div class="lco-detail-value">' + esc(value || '—') + '</div>' +
      '</div>';
  }

  // Back button
  document.getElementById('lcoDetailBack').addEventListener('click', function () {
    switchView('customers');
  });


  /* ══════════════════════════════════════════════
     SERVICES SUMMARY
     ══════════════════════════════════════════════ */

  function renderServicesSummary() {
    var cableCount = 0;
    var broadbandCount = 0;
    var bothCount = 0;
    var otherCount = 0;

    allCustomers.forEach(function (c) {
      if (c.service_status !== 'ACTIVE') return;
      switch (c.service_type) {
        case 'Cable TV': cableCount++; break;
        case 'Broadband': broadbandCount++; break;
        case 'Both': bothCount++; break;
        default: otherCount++; break;
      }
    });

    document.getElementById('lcoServiceCableCount').textContent = cableCount;
    document.getElementById('lcoServiceBroadbandCount').textContent = broadbandCount;
    document.getElementById('lcoServiceBothCount').textContent = bothCount;
    document.getElementById('lcoServiceOtherCount').textContent = otherCount;

    // Service status breakdown
    var activeCount = allCustomers.filter(function (c) { return c.service_status === 'ACTIVE'; }).length;
    var inactiveCount = allCustomers.filter(function (c) { return c.service_status === 'INACTIVE'; }).length;
    var suspendedCount = allCustomers.filter(function (c) { return c.service_status === 'SUSPENDED'; }).length;
    var disconnectedCount = allCustomers.filter(function (c) { return c.service_status === 'DISCONNECTED'; }).length;

    var statusGrid = document.getElementById('lcoServiceStatusGrid');
    statusGrid.innerHTML =
      '<div class="lco-detail-field"><div class="lco-detail-label">Active</div><div class="lco-detail-value">' + activeCount + '</div></div>' +
      '<div class="lco-detail-field"><div class="lco-detail-label">Inactive</div><div class="lco-detail-value">' + inactiveCount + '</div></div>' +
      '<div class="lco-detail-field"><div class="lco-detail-label">Suspended</div><div class="lco-detail-value">' + suspendedCount + '</div></div>' +
      '<div class="lco-detail-field"><div class="lco-detail-label">Disconnected</div><div class="lco-detail-value">' + disconnectedCount + '</div></div>';
  }


  /* ══════════════════════════════════════════════
     NOTIFICATIONS
     ══════════════════════════════════════════════ */

  async function loadNotifications() {
    var container = document.getElementById('lcoNotifList');
    if (!container) return;

    try {
      var { data, error } = await sb.from('notifications')
        .select('*')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      var notifications = data || [];

      // Update badge count
      var unreadCount = notifications.filter(function (n) { return !n.is_read; }).length;
      var badge = document.getElementById('lcoNotifCount');
      if (badge) {
        badge.textContent = unreadCount;
        badge.style.display = unreadCount > 0 ? '' : 'none';
      }

      if (notifications.length === 0) {
        container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">🔔</div><h3>No notifications</h3><p>You\'re all caught up!</p></div>';
        return;
      }

      container.innerHTML = notifications.map(function (notif) {
        var icon = '💬';
        if (notif.type === 'SUCCESS') icon = '✅';
        else if (notif.type === 'WARNING') icon = '⚠️';
        else if (notif.type === 'SYSTEM') icon = '🔧';
        else if (notif.type === 'INFO') icon = 'ℹ️';

        return '<div class="lco-notif-item' + (notif.is_read ? '' : ' unread') + '" data-notif-id="' + notif.id + '">' +
          '<div class="lco-notif-dot' + (notif.is_read ? ' read' : '') + '"></div>' +
          '<span class="lco-notif-icon">' + icon + '</span>' +
          '<div class="lco-notif-body">' +
          '<div class="lco-notif-title">' + esc(notif.title) + '</div>' +
          '<div class="lco-notif-message">' + esc(notif.message) + '</div>' +
          '<div class="lco-notif-time">' + formatDateFull(notif.created_at) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      // Mark as read on click
      container.querySelectorAll('.lco-notif-item.unread').forEach(function (item) {
        item.addEventListener('click', function () {
          markNotificationRead(item.dataset.notifId);
          item.classList.remove('unread');
          item.querySelector('.lco-notif-dot').classList.add('read');
        });
      });

    } catch (e) {
      console.error('Load notifications error:', e);
      container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">⚠️</div><h3>Unable to load notifications</h3></div>';
    }
  }

  async function markNotificationRead(notifId) {
    try {
      await sb.from('notifications')
        .update({ is_read: true })
        .eq('id', notifId);

      // Update badge
      var badge = document.getElementById('lcoNotifCount');
      if (badge) {
        var current = parseInt(badge.textContent) || 0;
        var newCount = Math.max(0, current - 1);
        badge.textContent = newCount;
        badge.style.display = newCount > 0 ? '' : 'none';
      }
    } catch (e) {
      console.error('Mark notification read error:', e);
    }
  }


  /* ══════════════════════════════════════════════
     PROFILE
     ══════════════════════════════════════════════ */

  function renderProfile() {
    if (!lcoData) return;

    // Avatar initials
    var initials = (lcoData.business_name || '').split(' ').map(function (w) { return w.charAt(0); }).join('').substring(0, 2).toUpperCase();
    document.getElementById('lcoProfileAvatar').textContent = initials;
    document.getElementById('lcoProfileBizName').textContent = lcoData.business_name;
    document.getElementById('lcoProfileStatus').innerHTML = '<span class="lco-badge active">ACTIVE</span>';

    // Business info grid
    var bizGrid = document.getElementById('lcoProfileBizGrid');
    bizGrid.innerHTML =
      detailField('Business / LCO Name', lcoData.business_name) +
      detailField('Owner Name', lcoData.owner_name) +
      detailField('Registered Email', lcoData.email) +
      detailField('Phone', lcoData.phone) +
      detailField('Address', lcoData.address, true) +
      detailField('City', lcoData.city) +
      detailField('State', lcoData.state) +
      detailField('PIN Code', lcoData.pincode);

    // Services
    var svcDiv = document.getElementById('lcoProfileServices');
    var tags = '<div class="lco-service-tags">';
    (lcoData.services || []).forEach(function (s) {
      var cls = '';
      if (s === 'Broadband' || s === 'Wi-Fi') cls = ' broadband';
      else if (s === 'Both') cls = ' both';
      tags += '<span class="lco-service-tag' + cls + '">' + esc(s) + '</span>';
    });
    tags += '</div>';
    if (lcoData.other_service_description) {
      tags += '<div style="margin-top:8px;font-size:13px;color:var(--slate);">Other: ' + esc(lcoData.other_service_description) + '</div>';
    }
    svcDiv.innerHTML = tags;

    // Service area
    var areaGrid = document.getElementById('lcoProfileAreaGrid');
    areaGrid.innerHTML =
      detailField('Locality', lcoData.service_area_locality, true) +
      detailField('City', lcoData.service_area_city) +
      detailField('State', lcoData.service_area_state) +
      detailField('PIN Code', lcoData.service_area_pincode);
    if (lcoData.service_area_description) {
      areaGrid.innerHTML += detailField('Description', lcoData.service_area_description, true);
    }

    // Account info
    var accountGrid = document.getElementById('lcoProfileAccountGrid');
    accountGrid.innerHTML =
      detailField('Application ID', lcoData.application_id) +
      detailField('Account Status', 'ACTIVE') +
      detailField('Registered', formatDateFull(lcoData.created_at)) +
      detailField('Last Updated', formatDateFull(lcoData.updated_at));
  }


  /* ══════════════════════════════════════════════
     ADD CUSTOMER MODAL
     ══════════════════════════════════════════════ */

  function setupAddCustomerModal() {
    var modal = document.getElementById('addCustomerModal');
    var openBtns = document.querySelectorAll('[data-action="add-customer"]');
    var cancelBtn = document.getElementById('addCustCancelBtn');
    var form = document.getElementById('addCustomerForm');

    openBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.classList.add('visible');
      });
    });

    cancelBtn.addEventListener('click', function () {
      modal.classList.remove('visible');
      form.reset();
      clearFormErrors();
    });

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.classList.remove('visible');
        form.reset();
        clearFormErrors();
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      addCustomer();
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        modal.classList.remove('visible');
        form.reset();
        clearFormErrors();
      }
    });
  }

  function clearFormErrors() {
    document.querySelectorAll('.lco-form-error').forEach(function (el) {
      el.classList.remove('visible');
    });
  }

  async function addCustomer() {
    var fullName = document.getElementById('custFullName').value.trim();
    var phone = document.getElementById('custPhone').value.trim();
    var email = document.getElementById('custEmail').value.trim();
    var address = document.getElementById('custAddress').value.trim();
    var city = document.getElementById('custCity').value.trim();
    var state = document.getElementById('custState').value.trim();
    var pincode = document.getElementById('custPincode').value.trim();
    var serviceType = document.getElementById('custServiceType').value;
    var planName = document.getElementById('custPlanName').value.trim();
    var notes = document.getElementById('custNotes').value.trim();

    // Validation
    var hasErrors = false;
    if (!fullName) { showFieldError('custFullName-error'); hasErrors = true; }
    if (!phone) { showFieldError('custPhone-error'); hasErrors = true; }
    if (!serviceType) { showFieldError('custServiceType-error'); hasErrors = true; }

    if (hasErrors) return;

    var btn = document.getElementById('addCustConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="lco-spinner"></span> Adding…';

    try {
      // Generate customer ID via RPC
      var { data: custIdData, error: custIdError } = await sb.rpc('generate_customer_id');
      if (custIdError) throw custIdError;

      var customerId = custIdData;

      // Insert customer
      var { data: newCust, error: insertError } = await sb.from('customers')
        .insert({
          customer_id: customerId,
          lco_id: lcoId,
          full_name: fullName,
          phone: phone,
          email: email || null,
          address: address || null,
          city: city || null,
          state: state || null,
          pincode: pincode || null,
          service_type: serviceType,
          plan_name: planName || null,
          service_status: 'ACTIVE',
          connection_date: new Date().toISOString().split('T')[0],
          notes: notes || null
        })
        .select()
        .single();

      if (insertError) throw insertError;

      showToast('Customer added successfully! ID: ' + customerId, 'success');

      // Close modal and reset form
      document.getElementById('addCustomerModal').classList.remove('visible');
      document.getElementById('addCustomerForm').reset();
      clearFormErrors();

      // Refresh data
      await loadCustomers();
      await loadStats();

    } catch (e) {
      console.error('Add customer error:', e);
      showToast('Failed to add customer. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '+ Add Customer';
    }
  }

  function showFieldError(errorId) {
    var el = document.getElementById(errorId);
    if (el) el.classList.add('visible');
  }


  /* ══════════════════════════════════════════════
     TOAST
     ══════════════════════════════════════════════ */

  function showToast(message, type) {
    var container = document.getElementById('lcoToastContainer');
    var toast = document.createElement('div');
    toast.className = 'lco-toast ' + (type || '');
    var icon = type === 'error' ? '⚠️' : type === 'success' ? '✓' : '💬';
    toast.innerHTML = '<span class="lco-toast-icon">' + icon + '</span>' + esc(message);
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
    }, 4000);
  }


  /* ══════════════════════════════════════════════
     UTILITY FUNCTIONS
     ══════════════════════════════════════════════ */

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderStatusBadge(status) {
    var cls = 'active';
    var label = status || 'ACTIVE';
    if (status === 'INACTIVE') cls = 'inactive';
    else if (status === 'SUSPENDED') cls = 'suspended';
    else if (status === 'DISCONNECTED') cls = 'disconnected';
    return '<span class="lco-badge ' + cls + '">' + label + '</span>';
  }

  function renderServiceTag(serviceType) {
    var cls = '';
    if (serviceType === 'Broadband' || serviceType === 'Wi-Fi') cls = ' broadband';
    else if (serviceType === 'Both') cls = ' both';
    return '<span class="lco-service-tag' + cls + '">' + esc(serviceType || '—') + '</span>';
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  function formatDateFull(dateStr) {
    if (!dateStr) return '—';
    try {
      var d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {
      return dateStr;
    }
  }


  /* ══════════════════════════════════════════════
     BOOTSTRAP
     ══════════════════════════════════════════════ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }

})();
