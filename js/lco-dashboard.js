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
  var currentServiceCatFilter = 'all';   // Phase 7: service category filter
  var currentPortalFilter = 'all';        // Phase 7: portal/invitation status filter

  // Phase 5: Plans & Subscriptions state
  var allPlans = [];
  var allSubscriptions = [];
  var currentPlanFilterType = 'all';
  var currentPlanFilterStatus = 'all';
  var currentPlanSearch = '';

  // Phase 8: Billing & Payments state
  var allBills = [];
  var allPayments = [];
  var currentBillFilter = 'all';
  var currentBillSearch = '';

  // Phase 9: Service Requests state
  var allRequests = [];
  var currentReqStatusFilter = 'ALL';
  var currentReqPriorityFilter = 'ALL';
  var currentReqCategoryFilter = 'ALL';
  var currentReqSearch = '';

  // Phase 10: Technicians state
  var allTechnicians = [];
  var currentTechStatusFilter = 'ALL';
  var currentTechInviteFilter = 'ALL';
  var currentTechSearch = '';


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
        await LCOAuth.signOut();
        LCOAuth.redirectToLogin();
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
    setupEditCustomerModal();    // Phase 7
    setupChangeStatusModal();   // Phase 7
    setupPlanListeners();
    setupSubscriptionModal();
    setupBillingListeners();    // Phase 8
    setupGenerateBillModal();  // Phase 8
    setupRecordPaymentModal();  // Phase 8
    setupRequestListeners();    // Phase 9
    setupManageRequestModal();  // Phase 9
    setupTechnicianListeners(); // Phase 10
    setupAddTechModal();        // Phase 10
    setupNotificationCenterListeners(); // Phase 11 Batch 1

    // Load initial data
    loadStats();
    loadCustomers();
    loadPlans();
    loadSubscriptions();
    loadNotifications();
    loadBillingData();         // Phase 8
    loadRequests();            // Phase 9
    loadTechnicians();         // Phase 10
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
    } else if (viewName === 'billing') {
      loadBillingData();
    } else if (viewName === 'requests') {
      loadRequests();
    } else if (viewName === 'technicians') {
      loadTechnicians();
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
    // Service status filter
    var filterGroup = document.getElementById('lcoFilterGroup');
    if (filterGroup) {
      filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setFilter(btn.dataset.filter);
        });
      });
    }

    // Phase 7: Service category filter
    var serviceCatGroup = document.getElementById('lcoServiceCategoryFilter');
    if (serviceCatGroup) {
      serviceCatGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentServiceCatFilter = btn.dataset.serviceCat;
          serviceCatGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderCustomersTable();
        });
      });
    }

    // Phase 7: Portal/invitation status filter
    var portalGroup = document.getElementById('lcoPortalStatusFilter');
    if (portalGroup) {
      portalGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentPortalFilter = btn.dataset.portalFilter;
          portalGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderCustomersTable();
        });
      });
    }
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
      // Service status filter
      if (currentFilter !== 'all' && cust.service_status !== currentFilter) return false;

      // Phase 7: Service category filter
      if (currentServiceCatFilter !== 'all' && cust.service_type !== currentServiceCatFilter) return false;

      // Phase 7: Portal/invitation status filter
      if (currentPortalFilter !== 'all') {
        var portalStatus;
        if (cust.user_id || cust.invitation_status === 'ACTIVATED') {
          portalStatus = 'ACTIVATED';
        } else if (cust.invitation_status === 'INVITED') {
          portalStatus = 'INVITED';
        } else {
          portalStatus = 'PENDING';
        }
        if (portalStatus !== currentPortalFilter) return false;
      }

      // Phase 7: Expanded search — covers all key fields
      if (currentSearch) {
        var haystack = [
          cust.customer_id,
          cust.full_name,
          cust.phone,
          cust.email,
          cust.service_type,
          cust.city,
          cust.state,
          cust.pincode,
          cust.plan_name,
          cust.notes,
          cust.service_status
        ].filter(Boolean).join(' ').toLowerCase();
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

    // Phase 5: Render current subscription
    renderCustomerDetailSubscriptions(cust);

    // Phase 7: Render full subscription history
    renderCustomerSubscriptionHistory(cust);

    // Phase 7: Wire Edit Customer button
    var editBtn = document.getElementById('lcoEditCustomerBtn');
    if (editBtn) {
      editBtn.onclick = function () { openEditCustomerModal(cust); };
    }

    // Phase 7: Wire Change Status button
    var changeStatusBtn = document.getElementById('lcoChangeStatusBtn');
    if (changeStatusBtn) {
      changeStatusBtn.onclick = function () { openChangeStatusModal(cust); };
    }

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
    // Renders ONLY the "Current Subscription & Plan" section (active sub)
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
      detailField('Price', plan ? '\u20b9' + plan.price + ' / ' + plan.duration + ' ' + plan.duration_unit.toLowerCase() : '\u2014') +
      detailField('Speed / Channels', plan ? (plan.speed_mbps ? plan.speed_mbps + ' Mbps' : (plan.channel_count ? plan.channel_count + ' Channels' : '\u2014')) : '\u2014') +
      detailField('Start Date', formatDate(activeSub.start_date)) +
      detailField('Expiry / End Date', formatDate(activeSub.end_date)) +
      '</div>' +

      (activeSub.notes ? '<div style="margin-top:10px; font-size:13px; color:var(--slate);">Notes: ' + esc(activeSub.notes) + '</div>' : '') +
      '</div>';

    container.innerHTML = html;
  }

  function renderCustomerSubscriptionHistory(customer) {
    // Phase 7: Renders ALL subscriptions including historical ones
    var container = document.getElementById('lcoSubHistoryContent');
    if (!container) return;

    var subs = allSubscriptions.filter(function (s) { return s.customer_id === customer.id; });

    // Sort: active first, then by start_date descending
    subs.sort(function (a, b) {
      if (a.status === 'ACTIVE' && b.status !== 'ACTIVE') return -1;
      if (b.status === 'ACTIVE' && a.status !== 'ACTIVE') return 1;
      return new Date(b.start_date) - new Date(a.start_date);
    });

    if (subs.length === 0) {
      container.innerHTML = '<div style="font-size:14px; color:var(--slate); padding:8px 0;">No subscription history found.</div>';
      return;
    }

    var html = subs.map(function (sub, idx) {
      var plan = sub.service_plans;
      var isActive = sub.status === 'ACTIVE';
      var borderStyle = isActive ? 'border-left: 3px solid var(--teal);' : '';

      return '<div class="lco-sub-card" style="margin-top:' + (idx === 0 ? '0' : '10') + 'px; ' + borderStyle + '">' +
        '<div class="lco-sub-header">' +
        '<div>' +
        '<div class="lco-sub-plan-name">' + esc(plan ? plan.name : (sub.notes || 'Subscription')) + '</div>' +
        '<div style="margin-top:4px;">' + renderServiceTag(plan ? plan.service_type : customer.service_type) + '</div>' +
        '</div>' +
        '<div style="display:flex; flex-direction:column; align-items:flex-end; gap:4px;">' +
        renderStatusBadge(sub.status) +
        (isActive ? '<span style="font-size:10px; color:var(--teal-dark); font-weight:600; text-transform:uppercase; letter-spacing:0.05em;">&#10003; Current</span>' : '') +
        '</div>' +
        '</div>' +
        '<div class="lco-detail-grid" style="margin-top:10px;">' +
        detailField('Plan Price', plan ? '\u20b9' + plan.price + ' / ' + plan.duration + ' ' + plan.duration_unit.toLowerCase() : '\u2014') +
        detailField('Speed / Channels', plan ? (plan.speed_mbps ? plan.speed_mbps + ' Mbps' : (plan.channel_count ? plan.channel_count + ' Channels' : '\u2014')) : '\u2014') +
        detailField('Start Date', formatDate(sub.start_date)) +
        detailField('End Date', formatDate(sub.end_date)) +
        '</div>' +
        (sub.notes ? '<div style="margin-top:8px; font-size:12px; color:var(--slate);">Notes: ' + esc(sub.notes) + '</div>' : '') +
        '</div>';
    }).join('');

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

  /* ══════════════════════════════════════════════
     NOTIFICATIONS & PREFERENCES (Phase 11 Batch 1)
     ══════════════════════════════════════════════ */

  var notifCategoryFilter = 'ALL';
  var notifStatusFilter = 'ALL';
  var notifPreferencesCache = [];

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

  function getCategoryMeta(cat) {
    switch (cat) {
      case 'ACCOUNT': return { label: 'Account', icon: '👤' };
      case 'SERVICE_REQUEST': return { label: 'Service Request', icon: '🛠️' };
      case 'PAYMENT': return { label: 'Payment', icon: '💳' };
      case 'ANNOUNCEMENT': return { label: 'Announcement', icon: '📢' };
      case 'SYSTEM': return { label: 'System', icon: '🔧' };
      case 'CUSTOMER_ACTIVITY': return { label: 'Customer Activity', icon: '👥' };
      case 'TECHNICIAN_ACTIVITY': return { label: 'Technician Activity', icon: '👷' };
      default: return { label: 'General', icon: '💬' };
    }
  }

  function setupNotificationCenterListeners() {
    var catGroup = document.getElementById('lcoNotifCategoryFilter');
    if (catGroup) {
      catGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          catGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          notifCategoryFilter = btn.dataset.cat || 'ALL';
          loadNotifications();
        });
      });
    }

    var statusGroup = document.getElementById('lcoNotifStatusFilter');
    if (statusGroup) {
      statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          notifStatusFilter = btn.dataset.status || 'ALL';
          loadNotifications();
        });
      });
    }

    var markAllBtn = document.getElementById('lcoMarkAllReadBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', markAllNotificationsRead);
    }

    var togglePrefBtn = document.getElementById('lcoTogglePrefBtn');
    var closePrefBtn = document.getElementById('lcoClosePrefBtn');
    var prefCard = document.getElementById('lcoNotifPrefCard');
    if (togglePrefBtn && prefCard) {
      togglePrefBtn.addEventListener('click', function() {
        var isHidden = prefCard.style.display === 'none';
        prefCard.style.display = isHidden ? 'block' : 'none';
        if (isHidden) loadNotificationPreferences();
      });
    }
    if (closePrefBtn && prefCard) {
      closePrefBtn.addEventListener('click', function() {
        prefCard.style.display = 'none';
      });
    }

    var savePrefBtn = document.getElementById('lcoSavePrefBtn');
    if (savePrefBtn) {
      savePrefBtn.addEventListener('click', saveNotificationPreferences);
    }

    setupNotifSubTabs();
    setupBroadcastModals();
  }

  async function loadNotifications() {
    var container = document.getElementById('lcoNotifList');
    if (!container) return;

    try {
      var query = sb.from('notifications')
        .select('*')
        .eq('lco_id', lcoId)
        .eq('recipient_role', 'LCO_ADMIN')
        .is('customer_id', null)
        .is('technician_id', null);

      if (notifCategoryFilter !== 'ALL') {
        query = query.eq('category', notifCategoryFilter);
      }
      if (notifStatusFilter === 'UNREAD') {
        query = query.eq('is_read', false);
      } else if (notifStatusFilter === 'READ') {
        query = query.eq('is_read', true);
      }

      var { data, error } = await query.order('created_at', { ascending: false }).limit(50);

      if (error) throw error;

      var notifications = data || [];

      // Update total unread badge
      var { count: unreadCount } = await sb.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('lco_id', lcoId)
        .eq('recipient_role', 'LCO_ADMIN')
        .is('customer_id', null)
        .is('technician_id', null)
        .eq('is_read', false);

      var badge = document.getElementById('lcoNotifCount');
      if (badge) {
        badge.textContent = unreadCount || 0;
        badge.style.display = (unreadCount && unreadCount > 0) ? '' : 'none';
      }

      if (notifications.length === 0) {
        container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">🔔</div><h3>No notifications found</h3><p>You\'re all caught up!</p></div>';
        return;
      }

      container.innerHTML = notifications.map(function (notif) {
        var catMeta = getCategoryMeta(notif.category);
        return '<div class="lco-notif-item' + (notif.is_read ? '' : ' unread') + '" data-notif-id="' + notif.id + '">' +
          '<div class="lco-notif-dot' + (notif.is_read ? ' read' : '') + '"></div>' +
          '<span class="lco-notif-icon">' + catMeta.icon + '</span>' +
          '<div class="lco-notif-body">' +
          '<div class="lco-notif-title">' + esc(notif.title) +
          '<span class="lco-notif-cat-badge cat-' + (notif.category || 'SYSTEM') + '">' + esc(catMeta.label) + '</span>' +
          '</div>' +
          '<div class="lco-notif-message">' + esc(notif.message) + '</div>' +
          '<div class="lco-notif-time">' + formatTimeAgo(notif.created_at) + ' • ' + formatDateFull(notif.created_at) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

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
      container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">⚠️</div><h3>Unable to load notifications</h3><button class="lco-quick-btn secondary" style="margin-top:12px;" onclick="loadNotifications()">Retry</button></div>';
    }
  }

  async function markNotificationRead(notifId) {
    try {
      await sb.from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
        .eq('recipient_role', 'LCO_ADMIN');

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

  async function markAllNotificationsRead() {
    try {
      var { error } = await sb.from('notifications')
        .update({ is_read: true })
        .eq('lco_id', lcoId)
        .eq('recipient_role', 'LCO_ADMIN')
        .is('customer_id', null)
        .is('technician_id', null)
        .eq('is_read', false);

      if (error) throw error;
      showToast('All notifications marked as read', 'success');
      loadNotifications();
    } catch (e) {
      console.error('Mark all read error:', e);
      showToast('Failed to mark all as read', 'error');
    }
  }

  async function loadNotificationPreferences() {
    var form = document.getElementById('lcoPrefForm');
    if (!form) return;
    form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:var(--slate);">Loading preferences…</div>';

    try {
      var { data, error } = await sb.rpc('get_my_notification_preferences', { p_role: 'LCO_ADMIN' });
      if (error) throw error;

      notifPreferencesCache = data || [];

      var categoryDescriptions = {
        'CUSTOMER_ACTIVITY': 'Alerts for customer account activations & updates.',
        'SERVICE_REQUEST': 'Notifications when service requests are created or updated.',
        'TECHNICIAN_ACTIVITY': 'Updates when technicians start work or resolve tickets.',
        'PAYMENT': 'Payment receipts & bill settlements.',
        'SYSTEM': 'System maintenance & security events.',
        'ANNOUNCEMENT': 'Platform feature releases & announcements.'
      };

      form.innerHTML = notifPreferencesCache.map(function(pref) {
        var catMeta = getCategoryMeta(pref.category);
        var desc = categoryDescriptions[pref.category] || 'Custom notification delivery preferences.';
        var isMandatory = (pref.category === 'SYSTEM');

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
              '<span>Email Alert</span>' +
              '<label class="lco-switch">' +
                '<input type="checkbox" class="pref-email" ' + (pref.channel_email ? 'checked' : '') + '>' +
                '<span class="lco-slider"></span>' +
              '</label>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

    } catch (e) {
      console.error('Load notification preferences error:', e);
      form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:#E74C3C;">Failed to load preferences.</div>';
    }
  }

  async function saveNotificationPreferences() {
    var saveBtn = document.getElementById('lcoSavePrefBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      var form = document.getElementById('lcoPrefForm');
      var updatedPrefs = [];
      form.querySelectorAll('.lco-pref-card').forEach(function(card) {
        var cat = card.dataset.cat;
        var inApp = card.querySelector('.pref-in-app').checked;
        var email = card.querySelector('.pref-email').checked;
        updatedPrefs.push({ category: cat, channel_in_app: inApp, channel_email: email });
      });

      var { data, error } = await sb.rpc('save_my_notification_preferences', {
        p_role: 'LCO_ADMIN',
        p_preferences: updatedPrefs
      });

      if (error) throw error;
      showToast('Notification preferences saved!', 'success');
      document.getElementById('lcoNotifPrefCard').style.display = 'none';
    } catch (e) {
      console.error('Save preferences error:', e);
      showToast('Failed to save preferences', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Preferences';
      }
    }
  }


  /* ══════════════════════════════════════════════
     BROADCASTS & URGENT NOTICES (Phase 11 Batch 2)
     ══════════════════════════════════════════════ */

  var activeNotifSubTab = 'feed';

  function setupNotifSubTabs() {
    var subTabBtns = document.querySelectorAll('.lco-sub-tab-btn[data-notif-tab]');
    subTabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        subTabBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeNotifSubTab = btn.dataset.notifTab;

        var feedWrap = document.getElementById('notifTabFeedContainer');
        var broadcastsWrap = document.getElementById('notifTabBroadcastsContainer');
        var urgentWrap = document.getElementById('notifTabUrgentContainer');
        var historyWrap = document.getElementById('notifTabHistoryContainer');

        if (feedWrap) feedWrap.style.display = (activeNotifSubTab === 'feed') ? 'block' : 'none';
        if (broadcastsWrap) broadcastsWrap.style.display = (activeNotifSubTab === 'broadcasts') ? 'block' : 'none';
        if (urgentWrap) urgentWrap.style.display = (activeNotifSubTab === 'urgent') ? 'block' : 'none';
        if (historyWrap) historyWrap.style.display = (activeNotifSubTab === 'history') ? 'block' : 'none';

        if (activeNotifSubTab === 'feed') {
          loadNotifications();
        } else if (activeNotifSubTab === 'broadcasts') {
          loadBroadcastHistory();
        } else if (activeNotifSubTab === 'urgent') {
          loadUrgentNoticesHistory();
        } else if (activeNotifSubTab === 'history') {
          loadCommunicationHistory();
        }
      });
    });

    var catSel = document.getElementById('lcoCommCategorySelect');
    if (catSel) {
      catSel.addEventListener('change', function() {
        if (activeNotifSubTab === 'history') loadCommunicationHistory();
      });
    }

    var searchInput = document.getElementById('lcoCommSearchInput');
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          if (activeNotifSubTab === 'history') loadCommunicationHistory();
        }, 300);
      });
    }
  }

  async function loadCommunicationHistory() {
    var body = document.getElementById('lcoCommHistoryBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--slate);">Loading communication history…</td></tr>';

    var category = document.getElementById('lcoCommCategorySelect') ? document.getElementById('lcoCommCategorySelect').value : 'ALL';
    var search = document.getElementById('lcoCommSearchInput') ? document.getElementById('lcoCommSearchInput').value.trim() : '';

    try {
      var { data, error } = await sb.rpc('get_lco_communication_history', {
        p_category: category,
        p_search: search || null
      });
      if (error) throw error;

      var events = data || [];
      if (events.length === 0) {
        body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--slate);">No communication history records found.</td></tr>';
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
          '<td><strong>' + esc(ev.recipient_name || '—') + '</strong> <span style="font-size:11px; color:#64748B;">(' + esc(ev.recipient_role || '') + ')</span></td>' +
          '<td>' + channelBadge + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + formatDateFull(ev.created_at) + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      console.error('Load communication history error:', e);
      body.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#DC2626;">Failed to load communication history.</td></tr>';
    }
  }

  function renderCategoryBadge(cat) {
    var cls = 'default';
    if (cat === 'ACCOUNT') cls = 'account';
    else if (cat === 'SERVICE_REQUEST') cls = 'service';
    else if (cat === 'PAYMENT') cls = 'payment';
    else if (cat === 'ANNOUNCEMENT') cls = 'announcement';
    else if (cat === 'TECHNICIAN_ACTIVITY') cls = 'technician';
    return '<span class="lco-notif-cat-badge ' + cls + '">' + esc(cat) + '</span>';
  }

  function renderChannelBadge(ch) {
    var bg = '#E2E8F0', color = '#334155';
    if (ch === 'In-App Feed') { bg = '#E0F2FE'; color = '#0369A1'; }
    else if (ch === 'Email Invite (Sent/Attempted)') { bg = '#FEF3C7'; color = '#92400E'; }
    else if (ch === 'Urgent Notice Banner') { bg = '#FEE2E2'; color = '#991B1B'; }
    else if (ch === 'Broadcast Feed') { bg = '#F3E8FF'; color = '#6B21A8'; }
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

  async function loadBroadcastHistory() {
    var body = document.getElementById('lcoBroadcastHistoryBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--slate);">Loading broadcast history…</td></tr>';

    try {
      var { data, error } = await sb.rpc('get_lco_broadcast_history');
      if (error) throw error;

      var broadcasts = data || [];
      if (broadcasts.length === 0) {
        body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--slate);">No broadcasts sent yet.</td></tr>';
        return;
      }

      body.innerHTML = broadcasts.map(function(b) {
        var audLabel = b.audience === 'ALL_CUSTOMERS' ? '👥 All Customers' : '🎯 Selected Customers';
        var statusBadge = b.status === 'EXPIRED' 
          ? '<span class="lco-badge" style="background:#64748B; color:white;">EXPIRED</span>'
          : '<span class="lco-badge active">ACTIVE</span>';

        return '<tr>' +
          '<td><strong style="color:#0F172A;">' + esc(b.title) + '</strong><div style="font-size:12px; color:#64748B; margin-top:2px;">' + esc(b.message) + '</div></td>' +
          '<td>' + audLabel + '</td>' +
          '<td><strong>' + (b.recipient_count || 0) + '</strong> customers</td>' +
          '<td>' + (b.expires_at ? formatDateFull(b.expires_at) : '— Never') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + formatDateFull(b.created_at) + '</td>' +
          '</tr>';
      }).join('');
    } catch (e) {
      console.error('Load broadcast history error:', e);
      body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#DC2626;">Failed to load broadcast history.</td></tr>';
    }
  }

  async function loadUrgentNoticesHistory() {
    var body = document.getElementById('lcoUrgentNoticesBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--slate);">Loading urgent notices…</td></tr>';

    try {
      var { data, error } = await sb.rpc('get_lco_urgent_notices_history');
      if (error) throw error;

      var notices = data || [];
      if (notices.length === 0) {
        body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--slate);">No urgent notices published yet.</td></tr>';
        return;
      }

      body.innerHTML = notices.map(function(un) {
        var audLabel = un.audience === 'ALL_CUSTOMERS' ? '👥 All Customers' : '🎯 Selected Customers';
        var statusBadge = '';
        if (un.status === 'INACTIVE') {
          statusBadge = '<span class="lco-badge" style="background:#94A3B8; color:white;">INACTIVE</span>';
        } else if (un.status === 'EXPIRED') {
          statusBadge = '<span class="lco-badge" style="background:#64748B; color:white;">EXPIRED</span>';
        } else {
          statusBadge = '<span class="lco-badge urgent" style="background:#DC2626; color:white;">🚨 ACTIVE</span>';
        }

        var toggleAction = un.is_active
          ? '<button class="lco-quick-btn secondary btn-toggle-urgent" data-notice-id="' + un.id + '" data-next-state="false" style="padding:4px 10px; font-size:12px; color:#DC2626; border-color:#FCA5A5;">Deactivate</button>'
          : '<button class="lco-quick-btn secondary btn-toggle-urgent" data-notice-id="' + un.id + '" data-next-state="true" style="padding:4px 10px; font-size:12px; color:#166534; border-color:#86EFAC;">Activate</button>';

        return '<tr>' +
          '<td><strong style="color:#B91C1C;">' + esc(un.title) + '</strong><div style="font-size:12px; color:#64748B; margin-top:2px;">' + esc(un.message) + '</div></td>' +
          '<td>' + audLabel + '</td>' +
          '<td><strong>' + (un.recipient_count || 0) + '</strong> customers</td>' +
          '<td><strong>' + (un.dismissal_count || 0) + '</strong> dismissed</td>' +
          '<td>' + (un.expires_at ? formatDateFull(un.expires_at) : '— Never') + '</td>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + formatDateFull(un.created_at) + '</td>' +
          '<td>' + toggleAction + '</td>' +
          '</tr>';
      }).join('');

      body.querySelectorAll('.btn-toggle-urgent').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var nId = btn.dataset.noticeId;
          var nextState = (btn.dataset.nextState === 'true');
          toggleUrgentNoticeStatus(nId, nextState);
        });
      });

    } catch (e) {
      console.error('Load urgent notices history error:', e);
      body.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#DC2626;">Failed to load urgent notices.</td></tr>';
    }
  }

  async function toggleUrgentNoticeStatus(noticeId, isActive) {
    try {
      var { error } = await sb.rpc('toggle_urgent_notice_status', {
        p_notice_id: noticeId,
        p_is_active: isActive
      });
      if (error) throw error;
      showToast(isActive ? 'Urgent notice activated!' : 'Urgent notice deactivated', 'success');
      loadUrgentNoticesHistory();
    } catch (e) {
      console.error('Toggle urgent notice status error:', e);
      showToast('Failed to update notice status', 'error');
    }
  }

  function setupBroadcastModals() {
    var broadcastModal = document.getElementById('createBroadcastModal');
    var openBroadcastBtn = document.getElementById('openCreateBroadcastBtn');
    var cancelBroadcastBtn = document.getElementById('cancelBroadcastBtn');
    var broadcastForm = document.getElementById('createBroadcastForm');

    var urgentModal = document.getElementById('createUrgentNoticeModal');
    var openUrgentBtn = document.getElementById('openCreateUrgentNoticeBtn');
    var cancelUrgentBtn = document.getElementById('cancelUrgentNoticeBtn');
    var urgentForm = document.getElementById('createUrgentNoticeForm');

    // Broadcast Audience Radio Toggle
    var bAudRadios = document.querySelectorAll('input[name="broadcastAudience"]');
    var bSelectWrap = document.getElementById('broadcastCustSelectWrap');
    bAudRadios.forEach(function(r) {
      r.addEventListener('change', function() {
        if (r.value === 'SELECTED_CUSTOMERS') {
          if (bSelectWrap) bSelectWrap.style.display = 'block';
          populateCustomerSelectBox('broadcastCustSelectBox');
        } else {
          if (bSelectWrap) bSelectWrap.style.display = 'none';
        }
      });
    });

    if (openBroadcastBtn && broadcastModal) {
      openBroadcastBtn.addEventListener('click', function() {
        broadcastModal.classList.add('visible');
        if (document.querySelector('input[name="broadcastAudience"]:checked').value === 'SELECTED_CUSTOMERS') {
          populateCustomerSelectBox('broadcastCustSelectBox');
        }
      });
    }

    if (cancelBroadcastBtn && broadcastModal) {
      cancelBroadcastBtn.addEventListener('click', function() {
        broadcastModal.classList.remove('visible');
        if (broadcastForm) broadcastForm.reset();
        if (bSelectWrap) bSelectWrap.style.display = 'none';
      });
    }

    if (broadcastForm) {
      broadcastForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleBroadcastSubmit();
      });
    }

    // Urgent Notice Audience Radio Toggle
    var uAudRadios = document.querySelectorAll('input[name="urgentAudience"]');
    var uSelectWrap = document.getElementById('urgentCustSelectWrap');
    uAudRadios.forEach(function(r) {
      r.addEventListener('change', function() {
        if (r.value === 'SELECTED_CUSTOMERS') {
          if (uSelectWrap) uSelectWrap.style.display = 'block';
          populateCustomerSelectBox('urgentCustSelectBox');
        } else {
          if (uSelectWrap) uSelectWrap.style.display = 'none';
        }
      });
    });

    if (openUrgentBtn && urgentModal) {
      openUrgentBtn.addEventListener('click', function() {
        urgentModal.classList.add('visible');
        if (document.querySelector('input[name="urgentAudience"]:checked').value === 'SELECTED_CUSTOMERS') {
          populateCustomerSelectBox('urgentCustSelectBox');
        }
      });
    }

    if (cancelUrgentBtn && urgentModal) {
      cancelUrgentBtn.addEventListener('click', function() {
        urgentModal.classList.remove('visible');
        if (urgentForm) urgentForm.reset();
        if (uSelectWrap) uSelectWrap.style.display = 'none';
      });
    }

    if (urgentForm) {
      urgentForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        await handleUrgentNoticeSubmit();
      });
    }
  }

  async function populateCustomerSelectBox(boxId) {
    var box = document.getElementById(boxId);
    if (!box) return;
    box.innerHTML = '<div style="font-size:13px; color:#64748B;">Loading active customers...</div>';

    try {
      var { data, error } = await sb.from('customers')
        .select('id, full_name, customer_id, phone')
        .eq('lco_id', lcoId)
        .eq('service_status', 'ACTIVE')
        .order('full_name', { ascending: true });

      if (error) throw error;
      var customers = data || [];
      if (customers.length === 0) {
        box.innerHTML = '<div style="font-size:13px; color:#DC2626;">No active customers found.</div>';
        return;
      }

      box.innerHTML = customers.map(function(c) {
        return '<label style="display:flex; align-items:center; gap:8px; padding:4px 0; font-size:13px; cursor:pointer; border-bottom:1px solid #F1F5F9;">' +
          '<input type="checkbox" class="cust-select-chk" value="' + c.id + '">' +
          '<span><strong>' + esc(c.full_name) + '</strong> (' + esc(c.customer_id) + ') — ' + esc(c.phone || '') + '</span>' +
          '</label>';
      }).join('');
    } catch (e) {
      console.error('Populate customer select box error:', e);
      box.innerHTML = '<div style="font-size:13px; color:#DC2626;">Failed to load active customers.</div>';
    }
  }

  async function handleBroadcastSubmit() {
    var title = document.getElementById('broadcastTitle').value.trim();
    var message = document.getElementById('broadcastMessage').value.trim();
    var audience = document.querySelector('input[name="broadcastAudience"]:checked').value;
    var expiresAtInput = document.getElementById('broadcastExpiresAt').value;
    var expiresAt = expiresAtInput ? new Date(expiresAtInput).toISOString() : null;

    var selectedCustIds = [];
    if (audience === 'SELECTED_CUSTOMERS') {
      var chks = document.querySelectorAll('#broadcastCustSelectBox .cust-select-chk:checked');
      chks.forEach(function(c) { selectedCustIds.push(c.value); });
      if (selectedCustIds.length === 0) {
        showToast('Please select at least one customer.', 'error');
        return;
      }
    }

    var submitBtn = document.getElementById('confirmBroadcastBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    try {
      var { data, error } = await sb.rpc('create_customer_broadcast', {
        p_title: title,
        p_message: message,
        p_audience: audience,
        p_customer_ids: selectedCustIds.length > 0 ? selectedCustIds : null,
        p_expires_at: expiresAt
      });

      if (error) throw error;

      showToast('Broadcast sent successfully to ' + (data ? data.recipient_count : 0) + ' customer(s)!', 'success');
      document.getElementById('createBroadcastModal').classList.remove('visible');
      document.getElementById('createBroadcastForm').reset();
      document.getElementById('broadcastCustSelectWrap').style.display = 'none';

      // Switch to Broadcast History tab and reload
      activeNotifSubTab = 'broadcasts';
      document.querySelectorAll('.lco-sub-tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.notifTab === 'broadcasts');
      });
      document.getElementById('notifTabFeedContainer').style.display = 'none';
      document.getElementById('notifTabBroadcastsContainer').style.display = 'block';
      document.getElementById('notifTabUrgentContainer').style.display = 'none';
      loadBroadcastHistory();

    } catch (e) {
      console.error('Create broadcast error:', e);
      showToast('Failed to create broadcast: ' + (e.message || ''), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send Broadcast';
    }
  }

  async function handleUrgentNoticeSubmit() {
    var title = document.getElementById('urgentNoticeTitle').value.trim();
    var message = document.getElementById('urgentNoticeMessage').value.trim();
    var audience = document.querySelector('input[name="urgentAudience"]:checked').value;
    var expiresAtInput = document.getElementById('urgentNoticeExpiresAt').value;
    var expiresAt = expiresAtInput ? new Date(expiresAtInput).toISOString() : null;

    var selectedCustIds = [];
    if (audience === 'SELECTED_CUSTOMERS') {
      var chks = document.querySelectorAll('#urgentCustSelectBox .cust-select-chk:checked');
      chks.forEach(function(c) { selectedCustIds.push(c.value); });
      if (selectedCustIds.length === 0) {
        showToast('Please select at least one customer.', 'error');
        return;
      }
    }

    var submitBtn = document.getElementById('confirmUrgentNoticeBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Publishing...';

    try {
      var { data, error } = await sb.rpc('create_urgent_notice', {
        p_title: title,
        p_message: message,
        p_audience: audience,
        p_customer_ids: selectedCustIds.length > 0 ? selectedCustIds : null,
        p_expires_at: expiresAt
      });

      if (error) throw error;

      showToast('Urgent notice published to ' + (data ? data.recipient_count : 0) + ' customer(s)!', 'success');
      document.getElementById('createUrgentNoticeModal').classList.remove('visible');
      document.getElementById('createUrgentNoticeForm').reset();
      document.getElementById('urgentCustSelectWrap').style.display = 'none';

      // Switch to Urgent Notices tab and reload
      activeNotifSubTab = 'urgent';
      document.querySelectorAll('.lco-sub-tab-btn').forEach(function(b) {
        b.classList.toggle('active', b.dataset.notifTab === 'urgent');
      });
      document.getElementById('notifTabFeedContainer').style.display = 'none';
      document.getElementById('notifTabBroadcastsContainer').style.display = 'none';
      document.getElementById('notifTabUrgentContainer').style.display = 'block';
      loadUrgentNoticesHistory();

    } catch (e) {
      console.error('Create urgent notice error:', e);
      showToast('Failed to create urgent notice: ' + (e.message || ''), 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Publish Urgent Notice';
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
      // Insert customer — customer_id is assigned atomically by DB BEFORE INSERT trigger
      var { data: newCust, error: insertError } = await sb.from('customers')
        .insert({
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

      var customerId = newCust.customer_id;

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
     PHASE 7: EDIT CUSTOMER MODAL
     ══════════════════════════════════════════════ */

  function setupEditCustomerModal() {
    var modal = document.getElementById('editCustomerModal');
    var cancelBtn = document.getElementById('editCustCancelBtn');
    var form = document.getElementById('editCustomerForm');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
        form.reset();
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.classList.remove('visible');
        form.reset();
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      saveEditedCustomer();
    });
  }

  function openEditCustomerModal(cust) {
    var modal = document.getElementById('editCustomerModal');
    if (!modal || !cust) return;

    document.getElementById('editCustDbId').value = cust.id;
    document.getElementById('editCustFullName').value = cust.full_name || '';
    document.getElementById('editCustPhone').value = cust.phone || '';
    document.getElementById('editCustEmail').value = cust.email || '';
    document.getElementById('editCustAddress').value = cust.address || '';
    document.getElementById('editCustCity').value = cust.city || '';
    document.getElementById('editCustState').value = cust.state || '';
    document.getElementById('editCustPincode').value = cust.pincode || '';
    document.getElementById('editCustServiceType').value = cust.service_type || 'Broadband';
    document.getElementById('editCustNotes').value = cust.notes || '';

    modal.classList.add('visible');
  }

  async function saveEditedCustomer() {
    var dbId = document.getElementById('editCustDbId').value;
    var fullName = document.getElementById('editCustFullName').value.trim();
    var phone = document.getElementById('editCustPhone').value.trim();
    var email = document.getElementById('editCustEmail').value.trim();
    var address = document.getElementById('editCustAddress').value.trim();
    var city = document.getElementById('editCustCity').value.trim();
    var state = document.getElementById('editCustState').value.trim();
    var pincode = document.getElementById('editCustPincode').value.trim();
    var serviceType = document.getElementById('editCustServiceType').value;
    var notes = document.getElementById('editCustNotes').value.trim();

    if (!fullName) {
      document.getElementById('editCustFullName-error').classList.add('visible');
      return;
    }
    if (!phone) {
      document.getElementById('editCustPhone-error').classList.add('visible');
      return;
    }

    var btn = document.getElementById('editCustConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="lco-spinner"></span> Saving…';

    try {
      var { error } = await sb.from('customers')
        .update({
          full_name: fullName,
          phone: phone,
          email: email || null,
          address: address || null,
          city: city || null,
          state: state || null,
          pincode: pincode || null,
          service_type: serviceType,
          notes: notes || null
        })
        .eq('id', dbId)
        .eq('lco_id', lcoId);

      if (error) throw error;

      showToast('Customer updated successfully!', 'success');

      document.getElementById('editCustomerModal').classList.remove('visible');
      document.getElementById('editCustomerForm').reset();

      // Refresh data and re-open detail view
      await loadCustomers();
      var updated = allCustomers.find(function (c) { return c.id === dbId; });
      if (updated) openCustomerDetail(updated.id);

    } catch (e) {
      console.error('Save edit customer error:', e);
      showToast('Failed to save changes. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  }


  /* ══════════════════════════════════════════════
     PHASE 7: CHANGE SERVICE STATUS MODAL
     ══════════════════════════════════════════════ */

  function setupChangeStatusModal() {
    var modal = document.getElementById('changeStatusModal');
    var cancelBtn = document.getElementById('changeStatusCancelBtn');
    var form = document.getElementById('changeStatusForm');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }

    modal.addEventListener('click', function (e) {
      if (e.target === modal) {
        modal.classList.remove('visible');
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      changeCustomerStatus();
    });
  }

  function openChangeStatusModal(cust) {
    var modal = document.getElementById('changeStatusModal');
    if (!modal || !cust) return;

    document.getElementById('changeStatusCustId').value = cust.id;
    document.getElementById('changeStatusCustName').value = cust.full_name + ' (' + cust.customer_id + ')';
    document.getElementById('changeStatusCurrentBadge').innerHTML = renderStatusBadge(cust.service_status);
    document.getElementById('changeStatusSelect').value = cust.service_status || 'ACTIVE';

    modal.classList.add('visible');
  }

  async function changeCustomerStatus() {
    var custId = document.getElementById('changeStatusCustId').value;
    var newStatus = document.getElementById('changeStatusSelect').value;

    if (!custId || !newStatus) return;

    // Guard: only allow DB-supported statuses
    var allowedStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'DISCONNECTED'];
    if (allowedStatuses.indexOf(newStatus) === -1) {
      showToast('Invalid status value.', 'error');
      return;
    }

    var btn = document.getElementById('changeStatusConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="lco-spinner"></span> Updating…';

    try {
      var { error } = await sb.from('customers')
        .update({ service_status: newStatus })
        .eq('id', custId)
        .eq('lco_id', lcoId);

      if (error) throw error;

      showToast('Service status changed to ' + newStatus, 'success');

      document.getElementById('changeStatusModal').classList.remove('visible');

      // Refresh data and re-open detail view
      await loadCustomers();
      await loadStats();
      var updated = allCustomers.find(function (c) { return c.id === custId; });
      if (updated) openCustomerDetail(updated.id);

    } catch (e) {
      console.error('Change status error:', e);
      showToast('Failed to update status. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Update Status';
    }
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
     PHASE 8: BILLING & PAYMENTS LOGIC
     ══════════════════════════════════════════════ */

  async function loadBillingData() {
    if (!lcoId) return;

    try {
      // 1. Fetch all bills for this LCO
      var { data: bills, error: billsErr } = await sb.from('customer_bills')
        .select('*, customers(full_name, customer_id)')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (billsErr) throw billsErr;
      allBills = bills || [];

      // 2. Fetch all payments for this LCO
      var { data: payments, error: payErr } = await sb.from('customer_payments')
        .select('*, customers(full_name, customer_id), customer_bills(bill_number)')
        .eq('lco_id', lcoId)
        .order('payment_date', { ascending: false });

      if (payErr) throw payErr;
      allPayments = payments || [];

      // 3. Render stats & tables
      renderBillingStats();
      renderBillsTable();
      renderPaymentsTable();

    } catch (err) {
      console.error('Load LCO billing data error:', err);
      showToast('Failed to load billing information.', 'error');
    }
  }

  function renderBillingStats() {
    var totalBilled = 0;
    var totalCollected = 0;
    var totalOutstanding = 0;
    var overdueCount = 0;

    allBills.forEach(function (b) {
      totalBilled += Number(b.amount || 0);
      var due = Number(b.amount || 0) - Number(b.paid_amount || 0);
      if (b.status === 'PENDING' || b.status === 'OVERDUE') {
        totalOutstanding += (due > 0 ? due : 0);
      }
      if (b.status === 'OVERDUE') {
        overdueCount++;
      }
    });

    allPayments.forEach(function (p) {
      totalCollected += Number(p.amount || 0);
    });

    var billedEl = document.getElementById('lcoBillingStatBilled');
    if (billedEl) billedEl.textContent = '₹' + totalBilled.toFixed(2);

    var collEl = document.getElementById('lcoBillingStatCollected');
    if (collEl) collEl.textContent = '₹' + totalCollected.toFixed(2);

    var outEl = document.getElementById('lcoBillingStatOutstanding');
    if (outEl) outEl.textContent = '₹' + totalOutstanding.toFixed(2);

    var odEl = document.getElementById('lcoBillingStatOverdue');
    if (odEl) odEl.textContent = overdueCount;
  }

  function renderBillsTable() {
    var tbody = document.getElementById('lcoBillsTableBody');
    if (!tbody) return;

    var filtered = getFilteredBills();

    if (filtered.length === 0) {
      var msg = currentBillSearch ? 'No bills match your search.' : 'No customer bills found.';
      tbody.innerHTML = '<tr><td colspan="8"><div class="lco-empty"><div class="lco-empty-icon">💳</div><h3>' + msg + '</h3></div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (b) {
      var custName = b.customers ? b.customers.full_name : '—';
      var custId = b.customers ? b.customers.customer_id : '';
      var isUnpaid = b.status === 'PENDING' || b.status === 'OVERDUE';

      return '<tr>' +
        '<td><strong>' + esc(b.bill_number) + '</strong></td>' +
        '<td>' + esc(custName) + (custId ? ' <span style="font-size:11px; color:var(--slate);">(' + esc(custId) + ')</span>' : '') + '</td>' +
        '<td>' + esc(b.plan_name) + '</td>' +
        '<td>₹' + Number(b.amount).toFixed(2) + '</td>' +
        '<td>₹' + Number(b.paid_amount).toFixed(2) + '</td>' +
        '<td>' + formatDate(b.due_date) + '</td>' +
        '<td>' + renderStatusBadge(b.status) + '</td>' +
        '<td>' +
        (isUnpaid ? '<button class="lco-view-btn record-pay-btn" data-bill-id="' + b.id + '" style="font-size:11px; padding:4px 8px;">💳 Record Payment</button>' : '—') +
        '</td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.record-pay-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openRecordPaymentModalForBill(btn.dataset.billId);
      });
    });
  }

  function getFilteredBills() {
    return allBills.filter(function (b) {
      if (currentBillFilter !== 'all' && b.status !== currentBillFilter) return false;

      if (currentBillSearch) {
        var custName = b.customers ? b.customers.full_name : '';
        var custId = b.customers ? b.customers.customer_id : '';
        var haystack = [b.bill_number, custName, custId, b.plan_name, b.status].join(' ').toLowerCase();
        return haystack.indexOf(currentBillSearch) !== -1;
      }
      return true;
    });
  }

  function renderPaymentsTable() {
    var tbody = document.getElementById('lcoPaymentsTableBody');
    if (!tbody) return;

    if (allPayments.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="lco-empty"><div class="lco-empty-icon">🧾</div><h3>No payment transactions recorded</h3></div></td></tr>';
      return;
    }

    tbody.innerHTML = allPayments.map(function (p) {
      var custName = p.customers ? p.customers.full_name : '—';
      var billNum = p.customer_bills ? p.customer_bills.bill_number : '—';

      return '<tr>' +
        '<td><strong>' + esc(p.payment_number) + '</strong></td>' +
        '<td>' + esc(custName) + '</td>' +
        '<td>' + esc(billNum) + '</td>' +
        '<td>₹' + Number(p.amount).toFixed(2) + '</td>' +
        '<td><span class="lco-badge">' + esc(p.payment_method) + '</span></td>' +
        '<td>' + formatDateFull(p.payment_date) + '</td>' +
        '<td>' + esc(p.transaction_reference || '—') + '</td>' +
        '</tr>';
    }).join('');
  }

  function setupBillingListeners() {
    var searchInput = document.getElementById('lcoBillingSearchInput');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentBillSearch = searchInput.value.trim().toLowerCase();
          renderBillsTable();
        }, 250);
      });
    }

    var filterGroup = document.getElementById('lcoBillingFilterGroup');
    if (filterGroup) {
      filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentBillFilter = btn.dataset.billFilter;
          filterGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderBillsTable();
        });
      });
    }

    var openGenBtn = document.getElementById('openGenerateBillBtn');
    if (openGenBtn) {
      openGenBtn.addEventListener('click', openGenerateBillModal);
    }

    var openRecBtn = document.getElementById('openRecordPaymentBtn');
    if (openRecBtn) {
      openRecBtn.addEventListener('click', function () { openRecordPaymentModalForBill(null); });
    }
  }

  function setupGenerateBillModal() {
    var modal = document.getElementById('generateBillModal');
    var form = document.getElementById('generateBillForm');
    var cancelBtn = document.getElementById('genBillCancelBtn');
    var custSelect = document.getElementById('genBillCustomerSelect');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { modal.classList.remove('visible'); });
    }

    if (custSelect) {
      custSelect.addEventListener('change', function () {
        var cust = allCustomers.find(function (c) { return c.id === custSelect.value; });
        if (cust) {
          if (cust.plan_name) document.getElementById('genBillPlanName').value = cust.plan_name;
        }
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var custId = custSelect.value;
      var planName = document.getElementById('genBillPlanName').value.trim();
      var amount = parseFloat(document.getElementById('genBillAmount').value);
      var pStart = document.getElementById('genBillPeriodStart').value;
      var pEnd = document.getElementById('genBillPeriodEnd').value;
      var dueDate = document.getElementById('genBillDueDate').value;
      var notes = document.getElementById('genBillNotes').value.trim();

      var confirmBtn = document.getElementById('genBillConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Generating…';

      try {
        var { data: newBill, error } = await sb.from('customer_bills')
          .insert({
            lco_id: lcoId,
            customer_id: custId,
            plan_name: planName,
            amount: amount,
            paid_amount: 0,
            billing_period_start: pStart,
            billing_period_end: pEnd,
            due_date: dueDate,
            status: 'PENDING',
            notes: notes || null
          })
          .select()
          .single();

        if (error) throw error;

        showToast('Bill ' + newBill.bill_number + ' generated successfully!', 'success');
        modal.classList.remove('visible');
        form.reset();
        await loadBillingData();

      } catch (err) {
        console.error('Generate bill error:', err);
        showToast('Failed to generate bill. ' + (err.message || ''), 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Generate Bill';
      }
    });
  }

  function openGenerateBillModal() {
    var modal = document.getElementById('generateBillModal');
    var custSelect = document.getElementById('genBillCustomerSelect');
    if (!modal || !custSelect) return;

    if (allCustomers.length === 0) {
      showToast('No customers available to bill.', 'warning');
      return;
    }

    custSelect.innerHTML = '<option value="">Select a customer…</option>' +
      allCustomers.map(function (c) {
        return '<option value="' + c.id + '">' + esc(c.full_name) + ' (' + esc(c.customer_id) + ')</option>';
      }).join('');

    // Pre-set dates
    var today = new Date();
    var firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    var lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];
    var due = new Date(today.getFullYear(), today.getMonth(), 15).toISOString().split('T')[0];

    document.getElementById('genBillPeriodStart').value = firstDay;
    document.getElementById('genBillPeriodEnd').value = lastDay;
    document.getElementById('genBillDueDate').value = due;

    modal.classList.add('visible');
  }

  function setupRecordPaymentModal() {
    var modal = document.getElementById('recordPaymentModal');
    var form = document.getElementById('recordPaymentForm');
    var cancelBtn = document.getElementById('recPayCancelBtn');
    var billSelect = document.getElementById('recPayBillSelect');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { modal.classList.remove('visible'); });
    }

    if (billSelect) {
      billSelect.addEventListener('change', function () {
        var bill = allBills.find(function (b) { return b.id === billSelect.value; });
        if (bill) {
          var due = Number(bill.amount) - Number(bill.paid_amount);
          document.getElementById('recPayAmount').value = due > 0 ? due.toFixed(2) : bill.amount;
        }
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var billId = billSelect.value;
      var amount = parseFloat(document.getElementById('recPayAmount').value);
      var method = document.getElementById('recPayMethod').value;
      var ref = document.getElementById('recPayReference').value.trim();
      var notes = document.getElementById('recPayNotes').value.trim();

      var bill = allBills.find(function (b) { return b.id === billId; });
      if (!bill) {
        showToast('Please select a valid bill.', 'error');
        return;
      }

      // Verify ownership (tenant guard)
      if (bill.lco_id !== lcoId) {
        showToast('Access denied: Bill does not belong to your account.', 'error');
        return;
      }

      // Verify amount is positive
      if (isNaN(amount) || amount <= 0) {
        showToast('Payment amount must be greater than zero.', 'error');
        return;
      }

      // Verify amount does not exceed outstanding balance
      var outstanding = Number(bill.amount) - Number(bill.paid_amount);
      if (amount > outstanding + 0.001) {
        showToast('Payment amount (₹' + amount.toFixed(2) + ') cannot exceed outstanding balance (₹' + outstanding.toFixed(2) + ').', 'error');
        return;
      }

      var confirmBtn = document.getElementById('recPayConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Recording…';

      try {
        // 1. Generate concurrency-safe payment number using DB sequence function
        var { data: payNumResult, error: numErr } = await sb.rpc('generate_payment_number');
        if (numErr) {
          console.warn('generate_payment_number RPC warning:', numErr);
        }
        var paymentNumber = payNumResult || ('PAY-' + new Date().getFullYear() + '-' + Math.floor(1000 + Math.random() * 9000));

        // 2. Insert payment record (no payment_status column)
        var { data: newPayment, error: payErr } = await sb.from('customer_payments')
          .insert({
            payment_number: paymentNumber,
            lco_id: lcoId,
            customer_id: bill.customer_id,
            bill_id: bill.id,
            amount: amount,
            payment_method: method,
            payment_date: new Date().toISOString(),
            transaction_reference: ref || ('MANUAL_' + Date.now()),
            notes: notes || null,
            recorded_by: currentUser ? currentUser.id : null,
            gateway: null
          })
          .select()
          .single();

        if (payErr) throw payErr;

        // 3. Update bill paid_amount and status
        var newPaidAmount = Number(bill.paid_amount) + amount;
        var newStatus = newPaidAmount >= Number(bill.amount) ? 'PAID' : 'PENDING';

        var { error: updateErr } = await sb.from('customer_bills')
          .update({
            paid_amount: Math.min(newPaidAmount, Number(bill.amount)),
            status: newStatus
          })
          .eq('id', bill.id)
          .eq('lco_id', lcoId);

        if (updateErr) throw updateErr;

        showToast('Payment recorded successfully! Receipt #: ' + (newPayment ? newPayment.payment_number : paymentNumber), 'success');
        modal.classList.remove('visible');
        form.reset();
        await loadBillingData();

      } catch (err) {
        console.error('Record payment error:', err);
        showToast('Failed to record payment. ' + (err.message || ''), 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Record Payment';
      }
    });
  }

  function openRecordPaymentModalForBill(billId) {
    var modal = document.getElementById('recordPaymentModal');
    var billSelect = document.getElementById('recPayBillSelect');
    if (!modal || !billSelect) return;

    var pendingBills = allBills.filter(function (b) { return b.status === 'PENDING' || b.status === 'OVERDUE'; });

    if (pendingBills.length === 0) {
      showToast('No pending or overdue bills to pay.', 'warning');
      return;
    }

    billSelect.innerHTML = '<option value="">Select pending bill…</option>' +
      pendingBills.map(function (b) {
        var custName = b.customers ? b.customers.full_name : 'Customer';
        var due = Number(b.amount) - Number(b.paid_amount);
        return '<option value="' + b.id + '">' + esc(b.bill_number) + ' — ' + esc(custName) + ' (Due: ₹' + due.toFixed(2) + ')</option>';
      }).join('');

    if (billId) {
      billSelect.value = billId;
      var bill = pendingBills.find(function (b) { return b.id === billId; });
      if (bill) {
        var due = Number(bill.amount) - Number(bill.paid_amount);
        document.getElementById('recPayAmount').value = due > 0 ? due.toFixed(2) : bill.amount;
      }
    }

    modal.classList.add('visible');
  }


  /* ══════════════════════════════════════════════
     PHASE 9: SERVICE REQUESTS & COMPLAINT LOGIC
     ══════════════════════════════════════════════ */

  async function loadRequests() {
    var tbody = document.getElementById('lcoRequestsTableBody');
    try {
      var { data, error } = await sb.from('service_requests')
        .select('*, customers(full_name, phone, customer_id)')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      allRequests = data || [];

      // Update sidebar nav count badge for OPEN/IN_PROGRESS requests
      var activeReqs = allRequests.filter(function (r) {
        return r.status === 'OPEN' || r.status === 'IN_PROGRESS';
      }).length;

      var countEl = document.getElementById('lcoRequestCount');
      if (countEl) {
        countEl.textContent = activeReqs;
        countEl.style.display = activeReqs > 0 ? '' : 'none';
      }

      renderRequestsTable();

    } catch (err) {
      console.error('Load service requests error:', err);
      showToast('Failed to load service requests.', 'error');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding:32px; color:var(--red);">Error loading service requests.</td></tr>';
      }
    }
  }

  function renderRequestsTable() {
    var tbody = document.getElementById('lcoRequestsTableBody');
    if (!tbody) return;

    var filtered = getFilteredRequests();

    if (filtered.length === 0) {
      var msg = currentReqSearch ? 'No service requests match your search.' : 'No service requests found.';
      tbody.innerHTML = '<tr><td colspan="9"><div class="lco-empty"><div class="lco-empty-icon">🛠️</div><h3>' + msg + '</h3><p>Customer service complaints will appear here automatically when submitted.</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (req) {
      var custName = req.customers ? req.customers.full_name : '—';
      var custPhone = req.customers ? req.customers.phone : '—';
      var techName = req.assigned_technician_name ? esc(req.assigned_technician_name) : '<span style="color:#94A3B8;">Unassigned</span>';

      return '<tr>' +
        '<td data-label="Ticket #"><strong>' + esc(req.request_id) + '</strong></td>' +
        '<td data-label="Customer">' + esc(custName) + '</td>' +
        '<td data-label="Phone">' + esc(custPhone) + '</td>' +
        '<td data-label="Category">' + esc(formatReqCategory(req.category)) + '</td>' +
        '<td data-label="Priority">' + renderReqPriorityBadge(req.priority) + '</td>' +
        '<td data-label="Status">' + renderReqStatusBadge(req.status) + '</td>' +
        '<td data-label="Technician">' + techName + '</td>' +
        '<td data-label="Date">' + formatDate(req.created_at) + '</td>' +
        '<td data-label="Action"><button class="lco-action-btn manage-req-btn" data-id="' + req.id + '">Manage</button></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.manage-req-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var req = allRequests.find(function (r) { return r.id === btn.dataset.id; });
        if (req) openManageRequestModal(req);
      });
    });
  }

  function getFilteredRequests() {
    return allRequests.filter(function (req) {
      // Status filter
      if (currentReqStatusFilter !== 'ALL' && req.status !== currentReqStatusFilter) return false;

      // Priority filter
      if (currentReqPriorityFilter !== 'ALL' && req.priority !== currentReqPriorityFilter) return false;

      // Category filter
      if (currentReqCategoryFilter !== 'ALL' && req.category !== currentReqCategoryFilter) return false;

      // Search query filter
      if (currentReqSearch) {
        var custName = req.customers ? req.customers.full_name : '';
        var custPhone = req.customers ? req.customers.phone : '';
        var custCode = req.customers ? req.customers.customer_id : '';
        var haystack = [
          req.request_id,
          custName,
          custPhone,
          custCode,
          req.subject,
          req.description,
          req.assigned_technician_name,
          req.assigned_technician_phone,
          req.resolution_notes,
          req.category
        ].filter(Boolean).join(' ').toLowerCase();

        return haystack.indexOf(currentReqSearch) !== -1;
      }

      return true;
    });
  }

  function setupRequestListeners() {
    var searchInput = document.getElementById('lcoReqSearchInput');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentReqSearch = searchInput.value.trim().toLowerCase();
          renderRequestsTable();
        }, 250);
      });
    }

    var statusGroup = document.getElementById('lcoReqStatusFilterGroup');
    if (statusGroup) {
      statusGroup.querySelectorAll('.lco-filter-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          currentReqStatusFilter = btn.dataset.status;
          statusGroup.querySelectorAll('.lco-filter-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          renderRequestsTable();
        });
      });
    }

    var prioritySelect = document.getElementById('lcoReqPriorityFilter');
    if (prioritySelect) {
      prioritySelect.addEventListener('change', function () {
        currentReqPriorityFilter = prioritySelect.value;
        renderRequestsTable();
      });
    }

    var categorySelect = document.getElementById('lcoReqCategoryFilter');
    if (categorySelect) {
      categorySelect.addEventListener('change', function () {
        currentReqCategoryFilter = categorySelect.value;
        renderRequestsTable();
      });
    }
  }

  function setupManageRequestModal() {
    var modal = document.getElementById('manageRequestModal');
    var form = document.getElementById('manageRequestForm');
    var cancelBtn = document.getElementById('manageReqCancelBtn');
    var techSelect = document.getElementById('manageReqTechSelect');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { modal.classList.remove('visible'); });
    }

    if (techSelect) {
      techSelect.addEventListener('change', function () {
        var selectedId = techSelect.value;
        if (selectedId) {
          var tech = allTechnicians.find(function (t) { return t.id === selectedId; });
          if (tech) {
            document.getElementById('manageReqTechName').value = tech.full_name || '';
            document.getElementById('manageReqTechPhone').value = tech.phone || '';
          }
        }
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var reqId = document.getElementById('manageReqDbId').value;
      var status = document.getElementById('manageReqStatus').value;
      var priority = document.getElementById('manageReqPriority').value;
      var selectedTechId = techSelect ? (techSelect.value || null) : null;
      var techName = document.getElementById('manageReqTechName').value.trim();
      var techPhone = document.getElementById('manageReqTechPhone').value.trim();
      var techNotes = document.getElementById('manageReqTechNotes').value.trim();
      var resNotes = document.getElementById('manageReqResolutionNotes').value.trim();
      var adminNotes = document.getElementById('manageReqAdminNotes').value.trim();

      var req = allRequests.find(function (r) { return r.id === reqId; });
      if (!req) {
        showToast('Invalid request selection.', 'error');
        return;
      }

      var confirmBtn = document.getElementById('manageReqConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Saving…';

      try {
        var isResolvedOrClosed = (status === 'RESOLVED' || status === 'CLOSED');
        var resolvedAt = isResolvedOrClosed ? (req.resolved_at || new Date().toISOString()) : null;

        var updatePayload = {
          status: status,
          priority: priority,
          assigned_technician_id: selectedTechId,
          assigned_technician_name: techName || null,
          assigned_technician_phone: techPhone || null,
          technician_notes: techNotes || null,
          resolution_notes: resNotes || null,
          admin_notes: adminNotes || null,
          resolved_at: resolvedAt
        };

        var { error } = await sb.from('service_requests')
          .update(updatePayload)
          .eq('id', reqId)
          .eq('lco_id', lcoId);

        if (error) throw error;

        showToast('Service Request ' + req.request_id + ' updated successfully!', 'success');
        modal.classList.remove('visible');
        form.reset();

        // Reload request list, notifications, and overview stats
        await loadRequests();
        await loadNotifications();
        await loadStats();

      } catch (err) {
        console.error('Update service request error:', err);
        showToast(err.message || 'Failed to update service request.', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save Updates';
      }
    });
  }

  function openManageRequestModal(req) {
    var modal = document.getElementById('manageRequestModal');
    if (!modal) return;

    document.getElementById('manageReqDbId').value = req.id;
    document.getElementById('manageReqHeaderId').textContent = req.request_id;
    document.getElementById('manageReqCustName').textContent = req.customers ? req.customers.full_name : 'Customer';
    document.getElementById('manageReqCustPhone').textContent = req.customers ? req.customers.phone : '—';
    document.getElementById('manageReqCategory').textContent = formatReqCategory(req.category);
    document.getElementById('manageReqSubject').textContent = req.subject;
    document.getElementById('manageReqDescription').textContent = req.description;
    document.getElementById('manageReqDate').textContent = 'Raised on: ' + formatDateFull(req.created_at);

    document.getElementById('manageReqStatus').value = req.status || 'OPEN';
    document.getElementById('manageReqPriority').value = req.priority || 'MEDIUM';

    // Populate active technician dropdown
    var techSelect = document.getElementById('manageReqTechSelect');
    if (techSelect) {
      techSelect.innerHTML = '<option value="">-- Unassigned --</option>' +
        allTechnicians.filter(function (t) { return t.status === 'ACTIVE'; }).map(function (t) {
          return '<option value="' + t.id + '">' + esc(t.full_name) + ' (' + esc(t.technician_id) + ')</option>';
        }).join('');
      techSelect.value = req.assigned_technician_id || '';
    }

    document.getElementById('manageReqTechName').value = req.assigned_technician_name || '';
    document.getElementById('manageReqTechPhone').value = req.assigned_technician_phone || '';
    document.getElementById('manageReqTechNotes').value = req.technician_notes || '';
    document.getElementById('manageReqResolutionNotes').value = req.resolution_notes || '';
    document.getElementById('manageReqAdminNotes').value = req.admin_notes || '';

    modal.classList.add('visible');
  }

  function formatReqCategory(cat) {
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

  function renderReqPriorityBadge(priority) {
    var p = priority || 'MEDIUM';
    var cls = p.toLowerCase();
    return '<span class="lco-badge priority-' + cls + '">' + p + '</span>';
  }

  function renderReqStatusBadge(status) {
    var s = status || 'OPEN';
    var cls = 'pending';
    if (s === 'OPEN') cls = 'pending';
    else if (s === 'IN_PROGRESS') cls = 'active';
    else if (s === 'RESOLVED') cls = 'active';
    else if (s === 'CLOSED') cls = 'inactive';
    else if (s === 'CANCELLED') cls = 'expired';
    return '<span class="lco-badge ' + cls + '">' + s + '</span>';
  }


  /* ══════════════════════════════════════════════
     PHASE 10: TECHNICIAN MANAGEMENT LOGIC
     ══════════════════════════════════════════════ */

  async function loadTechnicians() {
    var tbody = document.getElementById('lcoTechniciansTableBody');
    try {
      var { data, error } = await sb.from('technicians')
        .select('*')
        .eq('lco_id', lcoId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      allTechnicians = data || [];

      updateTechnicianStats();
      renderTechniciansTable();

    } catch (err) {
      console.error('Load technicians error:', err);
      showToast('Failed to load field technicians.', 'error');
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--red);">Error loading field technicians.</td></tr>';
      }
    }
  }

  function updateTechnicianStats() {
    var total = allTechnicians.length;
    var active = allTechnicians.filter(function (t) { return t.status === 'ACTIVE'; }).length;
    var activated = allTechnicians.filter(function (t) { return t.invitation_status === 'ACTIVATED' || t.user_id; }).length;
    var pending = allTechnicians.filter(function (t) { return t.invitation_status === 'INVITED' || t.invitation_status === 'PENDING'; }).length;

    var totalEl = document.getElementById('lcoTechStatTotal');
    if (totalEl) totalEl.textContent = total;

    var activeEl = document.getElementById('lcoTechStatActive');
    if (activeEl) activeEl.textContent = active;

    var actEl = document.getElementById('lcoTechStatActivated');
    if (actEl) actEl.textContent = activated;

    var pendEl = document.getElementById('lcoTechStatPending');
    if (pendEl) pendEl.textContent = pending;

    var countBadge = document.getElementById('lcoTechCount');
    if (countBadge) {
      countBadge.textContent = total;
      countBadge.style.display = total > 0 ? '' : 'none';
    }
  }

  function renderTechniciansTable() {
    var tbody = document.getElementById('lcoTechniciansTableBody');
    if (!tbody) return;

    var filtered = getFilteredTechnicians();

    if (filtered.length === 0) {
      var msg = currentTechSearch ? 'No technicians match your search.' : 'No field technicians added yet.';
      tbody.innerHTML = '<tr><td colspan="7"><div class="lco-empty"><div class="lco-empty-icon">👷</div><h3>' + msg + '</h3>' +
        (currentTechSearch ? '' : '<button class="lco-quick-btn primary" id="emptyAddTechBtn">+ Add Technician</button>') +
        '</div></td></tr>';

      var emptyBtn = document.getElementById('emptyAddTechBtn');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', openAddTechModal);
      }
      return;
    }

    tbody.innerHTML = filtered.map(function (tech) {
      var inviteBadge = renderTechInviteBadge(tech);
      var statusBadge = renderStatusBadge(tech.status);

      var inviteActionBtn = '';
      if (tech.invitation_status === 'ACTIVATED' || tech.user_id) {
        inviteActionBtn = '<span style="font-size:12px; color:#10B981; font-weight:600;">✓ Active</span>';
      } else {
        var label = tech.invitation_status === 'INVITED' ? 'Resend Invite' : 'Send Invite';
        inviteActionBtn = '<button class="lco-action-btn invite-tech-btn" data-id="' + tech.id + '">' + label + '</button>';
      }

      var statusToggleBtn = tech.status === 'ACTIVE'
        ? '<button class="lco-action-btn deactivate-tech-btn" data-id="' + tech.id + '" style="background:#FFF1F2; color:#E11D48; border-color:#FECDD3;">Deactivate</button>'
        : '<button class="lco-action-btn activate-tech-btn" data-id="' + tech.id + '" style="background:#F0FDF4; color:#16A34A; border-color:#BBF7D0;">Activate</button>';

      return '<tr>' +
        '<td data-label="Tech ID"><strong>' + esc(tech.technician_id) + '</strong></td>' +
        '<td data-label="Full Name">' + esc(tech.full_name) + '</td>' +
        '<td data-label="Contact Info"><div>📞 ' + esc(tech.phone) + '</div><div style="font-size:12px; color:var(--slate);">✉️ ' + esc(tech.email) + '</div></td>' +
        '<td data-label="Status">' + statusBadge + '</td>' +
        '<td data-label="Invitation">' + inviteBadge + '</td>' +
        '<td data-label="Date Joined">' + formatDate(tech.created_at) + '</td>' +
        '<td data-label="Action"><div style="display:flex; gap:6px; flex-wrap:wrap;">' + inviteActionBtn + ' ' + statusToggleBtn + '</div></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.invite-tech-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendTechnicianInvite(btn.dataset.id, btn);
      });
    });

    tbody.querySelectorAll('.deactivate-tech-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleTechnicianStatus(btn.dataset.id, 'INACTIVE');
      });
    });

    tbody.querySelectorAll('.activate-tech-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        toggleTechnicianStatus(btn.dataset.id, 'ACTIVE');
      });
    });
  }

  function renderTechInviteBadge(tech) {
    if (tech.user_id || tech.invitation_status === 'ACTIVATED') {
      return '<span class="lco-badge active">✓ Activated</span>';
    } else if (tech.invitation_status === 'INVITED') {
      return '<span class="lco-badge pending">📩 Invited</span>';
    } else if (tech.invitation_status === 'FAILED') {
      return '<span class="lco-badge expired">⚠️ Failed</span>';
    }
    return '<span class="lco-badge pending">⏳ Pending</span>';
  }

  function getFilteredTechnicians() {
    return allTechnicians.filter(function (tech) {
      if (currentTechStatusFilter !== 'ALL' && tech.status !== currentTechStatusFilter) return false;

      if (currentTechInviteFilter !== 'ALL') {
        var invStatus = tech.user_id || tech.invitation_status === 'ACTIVATED' ? 'ACTIVATED' : (tech.invitation_status || 'PENDING');
        if (invStatus !== currentTechInviteFilter) return false;
      }

      if (currentTechSearch) {
        var haystack = [
          tech.technician_id,
          tech.full_name,
          tech.phone,
          tech.email,
          tech.status
        ].filter(Boolean).join(' ').toLowerCase();
        return haystack.indexOf(currentTechSearch) !== -1;
      }

      return true;
    });
  }

  function setupTechnicianListeners() {
    var searchInput = document.getElementById('lcoTechSearchInput');
    if (searchInput) {
      var timer;
      searchInput.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          currentTechSearch = searchInput.value.trim().toLowerCase();
          renderTechniciansTable();
        }, 250);
      });
    }

    var statusSelect = document.getElementById('lcoTechStatusFilter');
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        currentTechStatusFilter = statusSelect.value;
        renderTechniciansTable();
      });
    }

    var inviteSelect = document.getElementById('lcoTechInviteFilter');
    if (inviteSelect) {
      inviteSelect.addEventListener('change', function () {
        currentTechInviteFilter = inviteSelect.value;
        renderTechniciansTable();
      });
    }

    var openAddBtn = document.getElementById('openAddTechBtn');
    if (openAddBtn) {
      openAddBtn.addEventListener('click', openAddTechModal);
    }
  }

  function setupAddTechModal() {
    var modal = document.getElementById('addTechModal');
    var form = document.getElementById('addTechForm');
    var cancelBtn = document.getElementById('addTechCancelBtn');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () { modal.classList.remove('visible'); });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var name = document.getElementById('addTechName').value.trim();
      var phone = document.getElementById('addTechPhone').value.trim();
      var email = document.getElementById('addTechEmail').value.trim().toLowerCase();

      var confirmBtn = document.getElementById('addTechConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Saving…';

      try {
        var { data: newTech, error } = await sb.from('technicians')
          .insert({
            lco_id: lcoId,
            full_name: name,
            phone: phone,
            email: email,
            status: 'ACTIVE'
          })
          .select()
          .single();

        if (error) throw error;

        showToast('Technician ' + newTech.technician_id + ' created! Sending activation invite…', 'success');
        modal.classList.remove('visible');
        form.reset();

        await loadTechnicians();
        sendTechnicianInvite(newTech.id, null);

      } catch (err) {
        console.error('Add technician error:', err);
        showToast(err.message || 'Failed to add technician.', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Save & Send Invite';
      }
    });
  }

  function openAddTechModal() {
    var modal = document.getElementById('addTechModal');
    if (modal) modal.classList.add('visible');
  }

  async function sendTechnicianInvite(techId, btn) {
    if (!sb) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span class="lco-spinner"></span> Sending…';
    }

    try {
      var { data, error } = await sb.functions.invoke('send-technician-invitation', {
        body: { technician_id: techId }
      });

      if (error) throw error;

      if (data && data.ok) {
        showToast('Technician invitation email sent successfully!', 'success');
        await loadTechnicians();
      } else {
        throw new Error(data ? (data.error || 'Invitation delivery failed.') : 'Invitation failed.');
      }
    } catch (err) {
      console.error('Send technician invite error:', err);
      showToast('Failed to send technician invitation: ' + (err.message || ''), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Resend Invite';
      }
    }
  }

  async function toggleTechnicianStatus(techId, newStatus) {
    try {
      var { error } = await sb.from('technicians')
        .update({ status: newStatus })
        .eq('id', techId)
        .eq('lco_id', lcoId);

      if (error) throw error;

      showToast('Technician status updated to ' + newStatus, 'success');
      await loadTechnicians();
    } catch (err) {
      console.error('Toggle technician status error:', err);
      showToast(err.message || 'Failed to update technician status.', 'error');
    }
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
