/* ============================================
   LCO CONNECT — LCO Dashboard Logic
   Phase 4 & 5: LCO Admin Dashboard, Plans & Subscriptions
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

  // Customer state
  var allCustomers = [];
  var currentDetailCustomer = null;
  var currentFilter = 'all';
  var currentSearch = '';

  // Phase 5: Plans & Subscriptions state
  var allPlans = [];
  var allSubscriptions = [];
  var currentPlanFilterType = 'all';
  var currentPlanFilterStatus = 'all';
  var currentPlanSearch = '';


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
    setupPlanListeners();
    setupSubscriptionModal();

    // Load initial data
    loadStats();
    loadCustomers();
    loadPlans();
    loadSubscriptions();
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
    } else if (viewName === 'plans') {
      loadPlans();
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

    if (!toggleBtn || !sidebar || !overlay) return;

    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('visible');
    });

    overlay.addEventListener('click', closeMobileNav);
  }

  function closeMobileNav() {
    var sidebar = document.getElementById('lcoSidebar');
    var overlay = document.getElementById('lcoSidebarOverlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('visible');
  }


  /* ══════════════════════════════════════════════
     LOGOUT
     ══════════════════════════════════════════════ */

  function setupLogout() {
    var btn = document.getElementById('lcoLogoutBtn');
    if (btn) {
      btn.addEventListener('click', async function () {
        await LCOAuth.signOut();
        LCOAuth.redirectToLogin();
      });
    }
  }


  /* ══════════════════════════════════════════════
     STAT CARD CLICKS
     ══════════════════════════════════════════════ */

  function setupStatCardClicks() {
    var totalCard = document.getElementById('lcoStatTotal');
    if (totalCard) {
      totalCard.addEventListener('click', function () {
        switchView('customers');
        setFilter('all');
      });
    }
    var activeCard = document.getElementById('lcoStatActive');
    if (activeCard) {
      activeCard.addEventListener('click', function () {
        switchView('customers');
        setFilter('ACTIVE');
      });
    }
    var inactiveCard = document.getElementById('lcoStatInactive');
    if (inactiveCard) {
      inactiveCard.addEventListener('click', function () {
        switchView('customers');
        setFilter('INACTIVE');
      });
    }
    var servicesCard = document.getElementById('lcoStatServices');
    if (servicesCard) {
      servicesCard.addEventListener('click', function () {
        switchView('plans');
      });
    }
  }


  /* ══════════════════════════════════════════════
     LOAD STATS
     ══════════════════════════════════════════════ */

  async function loadStats() {
    try {
      var { data: customersData, error: custError } = await sb.from('customers')
        .select('service_status')
        .eq('lco_id', lcoId);

      if (custError) throw custError;

      var total = customersData.length;
      var active = customersData.filter(function (c) { return c.service_status === 'ACTIVE'; }).length;
      var inactive = customersData.filter(function (c) { return c.service_status !== 'ACTIVE'; }).length;

      document.getElementById('lcoStatTotalValue').textContent = total;
      document.getElementById('lcoStatActiveValue').textContent = active;
      document.getElementById('lcoStatInactiveValue').textContent = inactive;

      // Active service plans count
      var { data: plansData } = await sb.from('service_plans')
        .select('id')
        .eq('lco_id', lcoId)
        .eq('status', 'ACTIVE');

      document.getElementById('lcoStatServicesValue').textContent = (plansData || []).length;

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
    if (!tbody) return;

    var recent = allCustomers.slice(0, 5);

    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="lco-empty"><div class="lco-empty-icon">👤</div><h3>No customers yet</h3><p>Add your first customer to get started.</p><button class="lco-quick-btn primary" onclick="document.getElementById(\'addCustomerModal\').classList.add(\'visible\')">+ Add Customer</button></div></td></tr>';
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
    if (!tbody) return;

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
    row += '<td data-label="Status">' + renderStatusBadge(cust.service_status) + renderPortalAccessBadge(cust) + '</td>';
    row += '<td data-label="Registered"><span class="lco-date">' + formatDate(cust.created_at) + '</span></td>';
    row += '<td data-label="Action"><button class="lco-view-btn" data-cust-id="' + cust.id + '">View</button></td>';
    row += '</tr>';
    return row;
  }

  function renderPortalAccessBadge(cust) {
    if (cust.user_id || cust.invitation_status === 'ACTIVATED') {
      return ' <span class="lco-badge active" style="font-size:10px; padding:2px 6px;" title="Portal Access Active">✓ Portal</span>';
    } else if (cust.invitation_status === 'INVITED') {
      return ' <span class="lco-badge pending" style="font-size:10px; padding:2px 6px;" title="Activation Email Sent">📩 Invited</span>';
    }
    return '';
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
     SEARCH & FILTER (Customers)
     ══════════════════════════════════════════════ */

  function setupSearch() {
    var searchInput = document.getElementById('lcoSearchInput');
    if (!searchInput) return;

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
    if (!filterGroup) return;

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
      detailField('Plan Name', cust.plan_name) +
      detailField('Service Status', cust.service_status) +
      detailField('Connection Date', cust.connection_date ? formatDate(cust.connection_date) : '—');

    // Account info
    var accountGrid = document.getElementById('lcoDetailAccountGrid');
    var activationStatusHtml = '<span class="lco-badge pending">⏳ Pending Activation</span>';
    if (cust.user_id || cust.invitation_status === 'ACTIVATED') {
      activationStatusHtml = '<span class="lco-badge active">✓ Activated</span>';
    } else if (cust.invitation_status === 'INVITED') {
      activationStatusHtml = '<span class="lco-badge pending">📩 Invitation Sent</span>';
    } else if (cust.invitation_status === 'FAILED') {
      activationStatusHtml = '<span class="lco-badge expired">⚠️ Delivery Failed</span>';
    }

    accountGrid.innerHTML =
      detailField('Service Status', cust.service_status) +
      detailField('Portal Access', activationStatusHtml) +
      detailField('Invitation Sent', cust.invitation_sent_at ? formatDateFull(cust.invitation_sent_at) : '—') +
      detailField('Created', formatDateFull(cust.created_at));

    // Resend activation email button setup
    var resendBtn = document.getElementById('lcoResendActivationBtn');
    if (resendBtn) {
      if (cust.user_id || cust.invitation_status === 'ACTIVATED') {
        resendBtn.disabled = true;
        resendBtn.textContent = '✓ Account Activated';
      } else if (!cust.email) {
        resendBtn.disabled = true;
        resendBtn.textContent = '📩 Resend Email (No Email Provided)';
      } else {
        resendBtn.disabled = false;
        resendBtn.textContent = '📩 Resend Activation Email';
        resendBtn.onclick = function () {
          triggerCustomerInvitation(cust.id, resendBtn);
        };
      }
    }

    // Notes
    var notesSection = document.getElementById('lcoDetailNotesSection');
    if (cust.notes) {
      notesSection.style.display = 'block';
      document.getElementById('lcoDetailNotes').textContent = cust.notes;
    } else {
      notesSection.style.display = 'none';
    }

    // Phase 5: Render customer subscription details
    renderCustomerDetailSubscriptions(cust);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function triggerCustomerInvitation(custId, btn) {
    if (!sb) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="lco-spinner"></span> Sending email…';
    }

    try {
      var { data, error } = await sb.functions.invoke('send-customer-invitation', {
        body: { customer_id: custId }
      });

      if (error) throw error;

      if (data && data.ok) {
        showToast('Activation email sent successfully!', 'success');
        await loadCustomers();
        if (currentDetailCustomer) {
          var updated = allCustomers.find(function (c) { return c.id === custId; });
          if (updated) openCustomerDetail(updated.id);
        }
      } else {
        throw new Error(data ? (data.error || 'SMTP2GO delivery failed.') : 'Invitation failed.');
      }
    } catch (err) {
      console.error('Trigger invitation error:', err);
      showToast('Failed to send email: ' + (err.message || ''), 'error');
    } finally {
      if (btn) {
        // Cooldown timer (30 seconds) to prevent spamming
        var cooldown = 30;
        btn.disabled = true;
        var interval = setInterval(function () {
          cooldown--;
          if (cooldown <= 0) {
            clearInterval(interval);
            btn.disabled = false;
            btn.textContent = '📩 Resend Activation Email';
          } else {
            btn.textContent = 'Resend in ' + cooldown + 's';
          }
        }, 1000);
      }
    }
  }

  function detailField(label, value, fullWidth) {
    return '<div class="lco-detail-field' + (fullWidth ? ' full-width' : '') + '">' +
      '<div class="lco-detail-label">' + esc(label) + '</div>' +
      '<div class="lco-detail-value">' + esc(value || '—') + '</div>' +
      '</div>';
  }

  // Back button
  var backBtn = document.getElementById('lcoDetailBack');
  if (backBtn) {
    backBtn.addEventListener('click', function () {
      switchView('customers');
    });
  }


  /* ══════════════════════════════════════════════
     PHASE 5: SERVICE PLANS LOGIC
     ══════════════════════════════════════════════ */

  async function loadPlans() {
    try {
      var { data, error } = await sb.from('service_plans')
        .select('*')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      allPlans = data || [];
      updatePlanStats();
      renderPlansGrid();

    } catch (e) {
      console.error('Load plans error:', e);
      showToast('Failed to load service plans.', 'error');
    }
  }

  function updatePlanStats() {
    var total = allPlans.length;
    var active = allPlans.filter(function (p) { return p.status === 'ACTIVE'; }).length;
    var broadband = allPlans.filter(function (p) { return p.service_type === 'Broadband'; }).length;
    var cable = allPlans.filter(function (p) { return p.service_type === 'Cable TV'; }).length;

    var totalEl = document.getElementById('lcoPlanStatTotal');
    if (totalEl) totalEl.textContent = total;

    var activeEl = document.getElementById('lcoPlanStatActive');
    if (activeEl) activeEl.textContent = active;

    var bbEl = document.getElementById('lcoPlanStatBroadband');
    if (bbEl) bbEl.textContent = broadband;

    var cableEl = document.getElementById('lcoPlanStatCable');
    if (cableEl) cableEl.textContent = cable;
  }

  function renderPlansGrid() {
    var container = document.getElementById('lcoPlansGrid');
    if (!container) return;

    var filtered = getFilteredPlans();

    if (filtered.length === 0) {
      var msg = currentPlanSearch ? 'No plans match your search.' : 'No service plans created yet.';
      container.innerHTML = '<div class="lco-empty" style="grid-column: 1 / -1;"><div class="lco-empty-icon">📦</div><h3>' + msg + '</h3><p>Create your first Broadband or Cable TV plan to start subscribing customers.</p><button class="lco-quick-btn primary" data-action="add-plan">+ Create Plan</button></div>';

      container.querySelectorAll('[data-action="add-plan"]').forEach(function (btn) {
        btn.addEventListener('click', function () { openPlanModal(); });
      });
      return;
    }

    container.innerHTML = filtered.map(function (plan) {
      var isInactive = plan.status === 'INACTIVE';
      var durationStr = plan.duration + ' ' + plan.duration_unit.toLowerCase();

      var featuresHtml = '';
      if (plan.service_type === 'Broadband' || plan.service_type === 'Both') {
        if (plan.speed_mbps) {
          featuresHtml += '<div class="lco-plan-feature-item"><span class="lco-plan-feature-icon">⚡</span> <strong>' + plan.speed_mbps + ' Mbps</strong> Speed</div>';
        }
        featuresHtml += '<div class="lco-plan-feature-item"><span class="lco-plan-feature-icon">📊</span> ' + (plan.data_limit_gb ? plan.data_limit_gb + ' GB Data' : 'Unlimited Data') + '</div>';
      }

      if (plan.service_type === 'Cable TV' || plan.service_type === 'Both') {
        if (plan.package_type) {
          featuresHtml += '<div class="lco-plan-feature-item"><span class="lco-plan-feature-icon">📺</span> ' + esc(plan.package_type) + '</div>';
        }
        if (plan.channel_count) {
          featuresHtml += '<div class="lco-plan-feature-item"><span class="lco-plan-feature-icon">📡</span> ' + plan.channel_count + ' Channels</div>';
        }
      }

      return '<div class="lco-plan-card' + (isInactive ? ' inactive' : '') + '" data-plan-id="' + plan.id + '">' +
        '<div>' +
        '<div class="lco-plan-header">' +
        '<div>' +
        '<div class="lco-plan-title">' + esc(plan.name) + '</div>' +
        '<div style="margin-top:4px;">' + renderServiceTag(plan.service_type) + '</div>' +
        '</div>' +
        '<div>' + renderStatusBadge(plan.status) + '</div>' +
        '</div>' +

        '<div class="lco-plan-price-wrap">' +
        '<span class="lco-plan-price">₹' + plan.price + '</span>' +
        '<span class="lco-plan-duration">/ ' + durationStr + '</span>' +
        '</div>' +

        (plan.description ? '<div class="lco-plan-desc">' + esc(plan.description) + '</div>' : '') +

        '<div class="lco-plan-features">' + featuresHtml + '</div>' +
        '</div>' +

        '<div class="lco-plan-actions">' +
        '<button class="lco-plan-btn edit-plan-btn" data-id="' + plan.id + '">Edit</button>' +
        '<button class="lco-plan-btn primary toggle-plan-btn" data-id="' + plan.id + '" data-status="' + plan.status + '">' +
        (isInactive ? 'Activate' : 'Deactivate') +
        '</button>' +
        '</div>' +
        '</div>';
    }).join('');

    // Attach click handlers
    container.querySelectorAll('.edit-plan-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var plan = allPlans.find(function (p) { return p.id === btn.dataset.id; });
        if (plan) openPlanModal(plan);
      });
    });

    container.querySelectorAll('.toggle-plan-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        togglePlanStatus(btn.dataset.id, btn.dataset.status);
      });
    });
  }

  function setupPlanListeners() {
    // Toolbar search & filters
    var searchInput = document.getElementById('lcoPlanSearchInput');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentPlanSearch = searchInput.value.trim().toLowerCase();
          renderPlansGrid();
        }, 250);
      });
    }

    var typeFilterGroup = document.getElementById('lcoPlanTypeFilterGroup');
    if (typeFilterGroup) {
      typeFilterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentPlanFilterType = btn.dataset.planType;
          typeFilterGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderPlansGrid();
        });
      });
    }

    var statusFilterGroup = document.getElementById('lcoPlanStatusFilterGroup');
    if (statusFilterGroup) {
      statusFilterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentPlanFilterStatus = btn.dataset.planStatus;
          statusFilterGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderPlansGrid();
        });
      });
    }

    // Modal open buttons
    document.querySelectorAll('[data-action="add-plan"]').forEach(function (btn) {
      btn.addEventListener('click', function () { openPlanModal(); });
    });

    // Form logic inside modal
    var modal = document.getElementById('planModal');
    var cancelBtn = document.getElementById('planCancelBtn');
    var form = document.getElementById('planForm');
    var serviceTypeSelect = document.getElementById('planServiceType');

    if (serviceTypeSelect) {
      serviceTypeSelect.addEventListener('change', updatePlanModalFields);
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
        form.reset();
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        savePlan();
      });
    }
  }

  function updatePlanModalFields() {
    var type = document.getElementById('planServiceType').value;
    var bbFields = document.getElementById('broadbandFields');
    var cableFields = document.getElementById('cableFields');

    if (type === 'Broadband') {
      bbFields.style.display = 'grid';
      cableFields.style.display = 'none';
    } else if (type === 'Cable TV') {
      bbFields.style.display = 'none';
      cableFields.style.display = 'grid';
    } else if (type === 'Both') {
      bbFields.style.display = 'grid';
      cableFields.style.display = 'grid';
    } else {
      bbFields.style.display = 'none';
      cableFields.style.display = 'none';
    }
  }

  function openPlanModal(plan) {
    var modal = document.getElementById('planModal');
    var form = document.getElementById('planForm');
    var title = document.getElementById('planModalTitle');
    var editId = document.getElementById('planEditId');

    form.reset();

    if (plan) {
      title.textContent = 'Edit Service Plan';
      editId.value = plan.id;
      document.getElementById('planName').value = plan.name;
      document.getElementById('planServiceType').value = plan.service_type;
      document.getElementById('planPrice').value = plan.price;
      document.getElementById('planDuration').value = plan.duration;
      document.getElementById('planDurationUnit').value = plan.duration_unit;
      document.getElementById('planSpeed').value = plan.speed_mbps || '';
      document.getElementById('planDataLimit').value = plan.data_limit_gb || '';
      document.getElementById('planPackageType').value = plan.package_type || 'Base Pack';
      document.getElementById('planChannelCount').value = plan.channel_count || '';
      document.getElementById('planDescription').value = plan.description || '';
      document.getElementById('planStatus').value = plan.status;
    } else {
      title.textContent = 'Create Service Plan';
      editId.value = '';
      document.getElementById('planStatus').value = 'ACTIVE';
    }

    updatePlanModalFields();
    modal.classList.add('visible');
  }

  async function savePlan() {
    var editId = document.getElementById('planEditId').value;
    var name = document.getElementById('planName').value.trim();
    var serviceType = document.getElementById('planServiceType').value;
    var price = parseFloat(document.getElementById('planPrice').value);
    var duration = parseInt(document.getElementById('planDuration').value) || 1;
    var durationUnit = document.getElementById('planDurationUnit').value;
    var speed = parseInt(document.getElementById('planSpeed').value) || null;
    var dataLimit = parseInt(document.getElementById('planDataLimit').value) || null;
    var packageType = document.getElementById('planPackageType').value;
    var channelCount = parseInt(document.getElementById('planChannelCount').value) || null;
    var description = document.getElementById('planDescription').value.trim();
    var status = document.getElementById('planStatus').value;

    if (!name || isNaN(price)) {
      showToast('Please fill in required plan details.', 'error');
      return;
    }

    var btn = document.getElementById('planConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="lco-spinner"></span> Saving…';

    try {
      var planData = {
        lco_id: lcoId,
        name: name,
        service_type: serviceType,
        price: price,
        duration: duration,
        duration_unit: durationUnit,
        speed_mbps: (serviceType === 'Broadband' || serviceType === 'Both') ? speed : null,
        data_limit_gb: (serviceType === 'Broadband' || serviceType === 'Both') ? dataLimit : null,
        package_type: (serviceType === 'Cable TV' || serviceType === 'Both') ? packageType : null,
        channel_count: (serviceType === 'Cable TV' || serviceType === 'Both') ? channelCount : null,
        description: description || null,
        status: status
      };

      if (editId) {
        var { error } = await sb.from('service_plans')
          .update(planData)
          .eq('id', editId)
          .eq('lco_id', lcoId);

        if (error) throw error;
        showToast('Plan updated successfully!', 'success');
      } else {
        var { error: insertError } = await sb.from('service_plans')
          .insert(planData);

        if (insertError) throw insertError;
        showToast('Plan created successfully!', 'success');
      }

      document.getElementById('planModal').classList.remove('visible');
      document.getElementById('planForm').reset();
      await loadPlans();
      await loadStats();

    } catch (e) {
      console.error('Save plan error:', e);
      showToast('Failed to save plan. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Plan';
    }
  }

  async function togglePlanStatus(planId, currentStatus) {
    var newStatus = currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      var { error } = await sb.from('service_plans')
        .update({ status: newStatus })
        .eq('id', planId)
        .eq('lco_id', lcoId);

      if (error) throw error;

      showToast('Plan status changed to ' + newStatus, 'success');
      await loadPlans();
      await loadStats();
    } catch (e) {
      console.error('Toggle plan error:', e);
      showToast('Failed to update status.', 'error');
    }
  }

  function getFilteredPlans() {
    return allPlans.filter(function (p) {
      if (currentPlanFilterType !== 'all' && p.service_type !== currentPlanFilterType) return false;
      if (currentPlanFilterStatus !== 'all' && p.status !== currentPlanFilterStatus) return false;
      if (currentPlanSearch) {
        var text = (p.name + ' ' + p.service_type + ' ' + p.price + ' ' + p.description).toLowerCase();
        return text.indexOf(currentPlanSearch) !== -1;
      }
      return true;
    });
  }


  /* ══════════════════════════════════════════════
     PHASE 5: CUSTOMER SUBSCRIPTIONS LOGIC
     ══════════════════════════════════════════════ */

  async function loadSubscriptions() {
    try {
      var { data, error } = await sb.from('customer_subscriptions')
        .select('*, service_plans(*)')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      allSubscriptions = data || [];

    } catch (e) {
      console.error('Load subscriptions error:', e);
    }
  }

  function setupSubscriptionModal() {
    var modal = document.getElementById('subscriptionModal');
    var form = document.getElementById('subForm');
    var cancelBtn = document.getElementById('subCancelBtn');
    var assignBtn = document.getElementById('lcoAssignSubBtn');
    var planSelect = document.getElementById('subPlanSelect');

    if (assignBtn) {
      assignBtn.addEventListener('click', function () {
        if (currentDetailCustomer) openSubscriptionModal(currentDetailCustomer);
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
        form.reset();
      });
    }

    if (planSelect) {
      planSelect.addEventListener('change', function () {
        autoCalculateExpiryDate();
      });
    }

    var startDateInput = document.getElementById('subStartDate');
    if (startDateInput) {
      startDateInput.addEventListener('change', function () {
        autoCalculateExpiryDate();
      });
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveSubscription();
      });
    }
  }

  function openSubscriptionModal(customer) {
    var modal = document.getElementById('subscriptionModal');
    var form = document.getElementById('subForm');
    form.reset();

    document.getElementById('subCustomerId').value = customer.id;
    document.getElementById('subCustomerName').value = customer.full_name + ' (' + customer.customer_id + ')';

    // Populate active plans dropdown
    var select = document.getElementById('subPlanSelect');
    var activePlans = allPlans.filter(function (p) { return p.status === 'ACTIVE'; });

    if (activePlans.length === 0) {
      select.innerHTML = '<option value="">No active plans available. Create a plan first!</option>';
    } else {
      select.innerHTML = '<option value="">Select a service plan</option>' +
        activePlans.map(function (p) {
          return '<option value="' + p.id + '">' + esc(p.name) + ' — ₹' + p.price + ' (' + p.service_type + ' / ' + p.duration + ' ' + p.duration_unit + ')</option>';
        }).join('');
    }

    // Default start date = today
    var today = new Date().toISOString().split('T')[0];
    document.getElementById('subStartDate').value = today;
    document.getElementById('subStatus').value = 'ACTIVE';

    modal.classList.add('visible');
  }

  function autoCalculateExpiryDate() {
    var planId = document.getElementById('subPlanSelect').value;
    var startDateStr = document.getElementById('subStartDate').value;

    if (!planId || !startDateStr) return;

    var plan = allPlans.find(function (p) { return p.id === planId; });
    if (!plan) return;

    var start = new Date(startDateStr);
    var end = new Date(start);

    if (plan.duration_unit === 'DAYS') {
      end.setDate(end.getDate() + plan.duration);
    } else if (plan.duration_unit === 'YEARS') {
      end.setFullYear(end.getFullYear() + plan.duration);
    } else { // MONTHS
      end.setMonth(end.getMonth() + plan.duration);
    }

    document.getElementById('subEndDate').value = end.toISOString().split('T')[0];
  }

  async function saveSubscription() {
    var customerId = document.getElementById('subCustomerId').value;
    var planId = document.getElementById('subPlanSelect').value;
    var startDate = document.getElementById('subStartDate').value;
    var endDate = document.getElementById('subEndDate').value;
    var status = document.getElementById('subStatus').value;
    var notes = document.getElementById('subNotes').value.trim();

    if (!customerId || !planId || !startDate || !endDate) {
      showToast('Please fill in all required subscription fields.', 'error');
      return;
    }

    var btn = document.getElementById('subConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="lco-spinner"></span> Confirming…';

    try {
      var plan = allPlans.find(function (p) { return p.id === planId; });

      // Insert customer subscription
      var { error: subError } = await sb.from('customer_subscriptions')
        .insert({
          lco_id: lcoId,
          customer_id: customerId,
          plan_id: planId,
          start_date: startDate,
          end_date: endDate,
          status: status,
          notes: notes || null
        });

      if (subError) throw subError;

      // Update customer table service fields to match active plan
      if (plan) {
        await sb.from('customers')
          .update({
            service_type: plan.service_type,
            plan_name: plan.name,
            service_status: status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE'
          })
          .eq('id', customerId);
      }

      showToast('Subscription assigned successfully!', 'success');

      document.getElementById('subscriptionModal').classList.remove('visible');
      document.getElementById('subForm').reset();

      await loadSubscriptions();
      await loadCustomers();

      // Refresh customer detail view if open
      if (currentDetailCustomer && currentDetailCustomer.id === customerId) {
        var updatedCust = allCustomers.find(function (c) { return c.id === customerId; });
        if (updatedCust) openCustomerDetail(updatedCust.id);
      }

    } catch (e) {
      console.error('Save subscription error:', e);
      showToast('Failed to assign subscription. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm Subscription';
    }
  }

  function renderCustomerDetailSubscriptions(customer) {
    var container = document.getElementById('lcoDetailSubscriptionContent');
    if (!container) return;

    var subs = allSubscriptions.filter(function (s) { return s.customer_id === customer.id; });

    if (subs.length === 0) {
      container.innerHTML = '<div class="lco-sub-card"><div style="display:flex; align-items:center; justify-content:space-between;"><div><strong>No Active Subscription</strong><div style="font-size:13px; color:var(--slate); margin-top:2px;">This customer does not have any plan assigned yet.</div></div><button class="lco-quick-btn primary" onclick="document.getElementById(\'lcoAssignSubBtn\').click()">+ Assign Plan</button></div></div>';
      return;
    }

    var activeSub = subs.find(function (s) { return s.status === 'ACTIVE'; }) || subs[0];
    var plan = activeSub.service_plans;

    var html = '<div class="lco-sub-card">' +
      '<div class="lco-sub-header">' +
      '<div>' +
      '<div class="lco-sub-plan-name">' + esc(plan ? plan.name : (customer.plan_name || 'Custom Subscription')) + '</div>' +
      '<div style="margin-top:4px;">' + renderServiceTag(plan ? plan.service_type : customer.service_type) + '</div>' +
      '</div>' +
      '<div>' + renderStatusBadge(activeSub.status) + '</div>' +
      '</div>' +

      '<div class="lco-detail-grid" style="margin-top:14px;">' +
      detailField('Price', plan ? '₹' + plan.price + ' / ' + plan.duration + ' ' + plan.duration_unit.toLowerCase() : '—') +
      detailField('Speed / Channels', plan ? (plan.speed_mbps ? plan.speed_mbps + ' Mbps' : (plan.channel_count ? plan.channel_count + ' Channels' : '—')) : '—') +
      detailField('Start Date', formatDate(activeSub.start_date)) +
      detailField('Expiry / End Date', formatDate(activeSub.end_date)) +
      '</div>' +

      (activeSub.notes ? '<div style="margin-top:10px; font-size:13px; color:var(--slate);">Notes: ' + esc(activeSub.notes) + '</div>' : '') +
      '</div>';

    container.innerHTML = html;
  }


  /* ══════════════════════════════════════════════
     SERVICES SUMMARY VIEW
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
    if (statusGrid) {
      statusGrid.innerHTML =
        '<div class="lco-detail-field"><div class="lco-detail-label">Active</div><div class="lco-detail-value">' + activeCount + '</div></div>' +
        '<div class="lco-detail-field"><div class="lco-detail-label">Inactive</div><div class="lco-detail-value">' + inactiveCount + '</div></div>' +
        '<div class="lco-detail-field"><div class="lco-detail-label">Suspended</div><div class="lco-detail-value">' + suspendedCount + '</div></div>' +
        '<div class="lco-detail-field"><div class="lco-detail-label">Disconnected</div><div class="lco-detail-value">' + disconnectedCount + '</div></div>';
    }
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
          var dot = item.querySelector('.lco-notif-dot');
          if (dot) dot.classList.add('read');
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

    if (!modal || !form) return;

    openBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.classList.add('visible');
      });
    });

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
        form.reset();
        clearFormErrors();
      });
    }

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
        if (form) form.reset();
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

      // Automatically trigger activation email if email address was provided
      if (email) {
        try {
          var targetId = (newCust && newCust.id) ? newCust.id : customerId;
          var { data: invData, error: invErr } = await sb.functions.invoke('send-customer-invitation', {
            body: { customer_id: targetId }
          });
          if (!invErr && invData && invData.ok) {
            showToast('Customer added & activation email sent! ID: ' + customerId, 'success');
          } else {
            console.warn('Auto invitation send failed:', invErr || (invData ? invData.error : 'Unknown error'));
            showToast('Customer added (ID: ' + customerId + ')! Note: Email delivery failed.', 'warning');
          }
        } catch (invErr) {
          console.warn('Auto invitation send error:', invErr);
          showToast('Customer added (ID: ' + customerId + ')! Email invitation could not be sent.', 'warning');
        }
      } else {
        showToast('Customer added successfully! ID: ' + customerId, 'success');
      }

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
      btn.textContent = '+ Add Customer';
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
    if (!container) return;

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
    else if (status === 'EXPIRED') cls = 'expired';
    else if (status === 'CANCELLED') cls = 'cancelled';
    else if (status === 'PENDING') cls = 'pending';
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
