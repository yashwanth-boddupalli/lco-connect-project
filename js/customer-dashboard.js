/* ============================================
   LCO CONNECT — Customer Dashboard Logic
   Phase 6: Customer Accounts & Dashboard
   ============================================
   Follows the same IIFE pattern as lco-dashboard.js.
   Uses LCOAuth shared module for authentication.
   ============================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     SUPABASE CLIENT
     ══════════════════════════════════════════════ */

  var sb = LCOAuth.getClient();


  /* ══════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════ */

  var currentUser = null;
  var customerData = null;      // customers table row
  var lcoProviderData = null;   // lco_applications table row
  var subscriptions = [];
  var activeSubscription = null;
  var availablePlans = [];
  var notifications = [];
  var activeBill = null;
  var billingHistory = [];
  var paymentHistory = [];
  var customerRequests = [];
  var currentView = 'overview';


  /* ══════════════════════════════════════════════
     AUTH GUARD
     ══════════════════════════════════════════════ */

  async function initAuth() {
    if (!sb) {
      showToast('Connection unavailable. Please refresh.', 'error');
      return;
    }

    try {
      var authData = await LCOAuth.requireRole('CUSTOMER', 'ACTIVE');
      if (!authData) return;

      currentUser = {
        id: authData.session.user.id,
        email: authData.profile.email || authData.session.user.email,
        role: authData.profile.role
      };

      // Fetch customer record linked to auth.users ID
      var { data: cust, error: custError } = await sb.from('customers')
        .select('*')
        .eq('user_id', currentUser.id)
        .limit(1)
        .maybeSingle();

      if (custError || !cust) {
        console.error('Customer profile error:', custError);
        await LCOAuth.signOut();
        LCOAuth.redirectToLogin();
        return;
      }

      customerData = cust;

      // Fetch customer's LCO provider details
      if (customerData.lco_id) {
        var { data: lco } = await sb.from('lco_applications')
          .select('business_name, owner_name, email, phone, city, state, service_area_locality')
          .eq('id', customerData.lco_id)
          .maybeSingle();

        lcoProviderData = lco;
      }

      // Show dashboard
      document.getElementById('custLoadingScreen').style.display = 'none';
      document.getElementById('custDashboardContainer').style.display = 'block';

      // Set header user name
      var headerNameEl = document.getElementById('custHeaderName');
      if (headerNameEl) headerNameEl.textContent = customerData.full_name;

      // Initialize Dashboard
      initDashboard();

    } catch (e) {
      console.error('Customer Auth check failed:', e);
      LCOAuth.redirectToLogin();
    }
  }


  /* ══════════════════════════════════════════════
     DASHBOARD INITIALIZATION
     ══════════════════════════════════════════════ */

  function initDashboard() {
    setupNavigation();
    setupMobileNav();
    setupLogout();
    setupEditProfileModal();
    setupRequestPlanModal();
    setupCreateRequestModal();
    setupCustReqDetailModal();
    setupPayNow();
    setupNotificationCenterListeners(); // Phase 11 Batch 1

    // Render overview
    renderOverview();
    loadActiveUrgentNotices();

    // Load data async
    loadSubscriptions();
    loadAvailablePlans();
    loadNotifications();
    loadBillingData();
    loadCustomerRequests();
  }


  /* ══════════════════════════════════════════════
     NAVIGATION
     ══════════════════════════════════════════════ */

  function setupNavigation() {
    var navItems = document.querySelectorAll('.cust-nav-item[data-view]');
    navItems.forEach(function (item) {
      item.addEventListener('click', function () {
        switchView(item.dataset.view);
        closeMobileNav();
      });
    });
  }

  function switchView(viewName) {
    currentView = viewName;

    // Update nav items
    document.querySelectorAll('.cust-nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.cust-view').forEach(function (view) {
      view.classList.remove('active');
    });

    var targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Specific view actions
    if (viewName === 'overview') {
      renderOverview();
      loadActiveUrgentNotices();
    } else if (viewName === 'profile') {
      renderProfile();
    } else if (viewName === 'service') {
      renderService();
    } else if (viewName === 'subscription') {
      renderSubscription();
    } else if (viewName === 'billing') {
      loadBillingData();
    } else if (viewName === 'plans') {
      renderAvailablePlans();
    } else if (viewName === 'requests') {
      loadCustomerRequests();
    } else if (viewName === 'notifications') {
      loadNotifications();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setupMobileNav() {
    var toggleBtn = document.getElementById('custMobileNavToggle');
    var sidebar = document.getElementById('custSidebar');
    if (!toggleBtn || !sidebar) return;

    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
    });
  }

  function closeMobileNav() {
    var sidebar = document.getElementById('custSidebar');
    if (sidebar) sidebar.classList.remove('open');
  }


  /* ══════════════════════════════════════════════
     LOGOUT
     ══════════════════════════════════════════════ */

  function setupLogout() {
    var btn = document.getElementById('custLogoutBtn');
    if (btn) {
      btn.addEventListener('click', async function () {
        await LCOAuth.signOut();
        LCOAuth.redirectToLogin();
      });
    }
  }


  /* ══════════════════════════════════════════════
     OVERVIEW VIEW
     ══════════════════════════════════════════════ */

  function renderOverview() {
    if (!customerData) return;

    document.getElementById('custHeroName').textContent = 'Welcome Back, ' + customerData.full_name + '!';
    document.getElementById('custHeroId').textContent = 'ID: ' + customerData.customer_id;
    document.getElementById('custHeroServiceType').textContent = customerData.service_type || '—';
    document.getElementById('custHeroPlanName').textContent = customerData.plan_name || 'No Plan';
    document.getElementById('custHeroStatus').innerHTML = renderStatusBadge(customerData.service_status);

    document.getElementById('custOverviewCategory').textContent = customerData.service_type || '—';

    // Provider info grid
    renderProviderInfo();
  }


  /* ══════════════════════════════════════════════
     ACTIVE URGENT NOTICES (Phase 11 Batch 2)
     ══════════════════════════════════════════════ */

  async function loadActiveUrgentNotices() {
    var container = document.getElementById('custActiveUrgentNoticesContainer');
    if (!container) return;

    try {
      var { data, error } = await sb.rpc('get_active_urgent_notices_for_customer');
      if (error) throw error;

      var notices = data || [];
      if (notices.length === 0) {
        container.innerHTML = '';
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';
      container.innerHTML = notices.map(function(un) {
        var expiryText = un.expires_at ? (' • Valid until: ' + formatDate(un.expires_at)) : '';

        return '<div class="cust-urgent-alert-card" data-notice-id="' + un.id + '" style="background:#FEF2F2; border:1px solid #FCA5A5; border-left:6px solid #DC2626; border-radius:8px; padding:16px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; box-shadow:0 4px 6px -1px rgba(220,38,38,0.1);">' +
          '<div style="flex:1;">' +
            '<div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">' +
              '<span style="font-size:18px;">🚨</span>' +
              '<h4 style="margin:0; font-size:16px; color:#991B1B; font-weight:700;">' + esc(un.title) + '</h4>' +
              '<span class="cust-badge" style="background:#DC2626; color:white; font-size:11px; padding:2px 8px;">URGENT NOTICE</span>' +
            '</div>' +
            '<div style="font-size:14px; color:#7F1D1D; line-height:1.5;">' + esc(un.message) + '</div>' +
            '<div style="font-size:12px; color:#991B1B; margin-top:8px; font-weight:500;">Posted: ' + formatDate(un.created_at) + expiryText + '</div>' +
          '</div>' +
          '<button class="btn-dismiss-urgent-notice" data-notice-id="' + un.id + '" style="background:#FEE2E2; color:#991B1B; border:1px solid #FCA5A5; border-radius:6px; padding:6px 12px; font-size:13px; font-weight:600; cursor:pointer; white-space:nowrap; transition:all 0.2s;">Dismiss ✕</button>' +
        '</div>';
      }).join('');

      container.querySelectorAll('.btn-dismiss-urgent-notice').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var nId = btn.dataset.noticeId;
          dismissUrgentNotice(nId);
        });
      });

    } catch (e) {
      console.error('Load active urgent notices error:', e);
      container.style.display = 'none';
    }
  }

  async function dismissUrgentNotice(noticeId) {
    try {
      var { error } = await sb.rpc('dismiss_urgent_notice', { p_notice_id: noticeId });
      if (error) throw error;

      showToast('Urgent notice dismissed.', 'info');
      var card = document.querySelector('.cust-urgent-alert-card[data-notice-id="' + noticeId + '"]');
      if (card) {
        card.style.opacity = '0';
        card.style.transition = 'opacity 0.3s';
        setTimeout(function() {
          if (card.parentNode) card.parentNode.removeChild(card);
          var container = document.getElementById('custActiveUrgentNoticesContainer');
          if (container && container.children.length === 0) {
            container.style.display = 'none';
          }
        }, 300);
      }
    } catch (e) {
      console.error('Dismiss urgent notice error:', e);
      showToast('Failed to dismiss notice', 'error');
    }
  }

  function renderProviderInfo() {
    var container = document.getElementById('custProviderGrid');
    if (!container) return;

    if (!lcoProviderData) {
      container.innerHTML = '<div style="font-size:14px; color:#64748B;">Operator details unavailable.</div>';
      return;
    }

    container.innerHTML =
      detailField('Business / LCO Name', lcoProviderData.business_name) +
      detailField('Contact Owner', lcoProviderData.owner_name) +
      detailField('Phone', lcoProviderData.phone) +
      detailField('Email', lcoProviderData.email) +
      detailField('City & State', (lcoProviderData.city || '') + ', ' + (lcoProviderData.state || '')) +
      detailField('Locality', lcoProviderData.service_area_locality || '—');
  }


  /* ══════════════════════════════════════════════
     PROFILE VIEW
     ══════════════════════════════════════════════ */

  function renderProfile() {
    if (!customerData) return;

    var personalGrid = document.getElementById('custProfilePersonalGrid');
    if (personalGrid) {
      personalGrid.innerHTML =
        detailField('Customer ID', customerData.customer_id) +
        detailField('Full Name', customerData.full_name) +
        detailField('Phone', customerData.phone) +
        detailField('Email', customerData.email || '—') +
        detailField('Registered Date', formatDate(customerData.created_at));
    }

    var addressGrid = document.getElementById('custProfileAddressGrid');
    if (addressGrid) {
      addressGrid.innerHTML =
        detailField('Address', customerData.address || '—') +
        detailField('City', customerData.city || '—') +
        detailField('State', customerData.state || '—') +
        detailField('PIN Code', customerData.pincode || '—');
    }
  }


  /* ══════════════════════════════════════════════
     EDIT PROFILE MODAL
     ══════════════════════════════════════════════ */

  function setupEditProfileModal() {
    var modal = document.getElementById('editProfileModal');
    var openBtn = document.getElementById('openEditProfileBtn');
    var cancelBtn = document.getElementById('cancelEditProfileBtn');
    var form = document.getElementById('editProfileForm');

    if (!modal || !form) return;

    if (openBtn) {
      openBtn.addEventListener('click', function () {
        document.getElementById('editCustPhone').value = customerData.phone || '';
        document.getElementById('editCustEmail').value = customerData.email || '';
        document.getElementById('editCustAddress').value = customerData.address || '';
        document.getElementById('editCustCity').value = customerData.city || '';
        document.getElementById('editCustState').value = customerData.state || '';
        document.getElementById('editCustPincode').value = customerData.pincode || '';

        modal.classList.add('visible');
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var phone = document.getElementById('editCustPhone').value.trim();
      var email = document.getElementById('editCustEmail').value.trim();
      var address = document.getElementById('editCustAddress').value.trim();
      var city = document.getElementById('editCustCity').value.trim();
      var state = document.getElementById('editCustState').value.trim();
      var pincode = document.getElementById('editCustPincode').value.trim();

      if (!phone) {
        showToast('Phone number is required.', 'error');
        return;
      }

      var saveBtn = document.getElementById('saveEditProfileBtn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="lco-spinner"></span> Saving…';

      try {
        var { error } = await sb.from('customers')
          .update({
            phone: phone,
            email: email || null,
            address: address || null,
            city: city || null,
            state: state || null,
            pincode: pincode || null
          })
          .eq('user_id', currentUser.id);

        if (error) throw error;

        // Update local state
        customerData.phone = phone;
        customerData.email = email;
        customerData.address = address;
        customerData.city = city;
        customerData.state = state;
        customerData.pincode = pincode;

        showToast('Profile updated successfully!', 'success');
        modal.classList.remove('visible');
        renderProfile();
        renderOverview();

      } catch (err) {
        console.error('Update profile error:', err);
        showToast('Failed to update profile.', 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });
  }


  /* ══════════════════════════════════════════════
     SERVICE VIEW
     ══════════════════════════════════════════════ */

  function renderService() {
    if (!customerData) return;

    document.getElementById('custServiceStatusBadge').innerHTML = renderStatusBadge(customerData.service_status);

    var grid = document.getElementById('custServiceGrid');
    if (grid) {
      grid.innerHTML =
        detailField('Service Type', customerData.service_type) +
        detailField('Current Plan', customerData.plan_name || 'No plan assigned') +
        detailField('Service Status', customerData.service_status) +
        detailField('Connection Date', customerData.connection_date ? formatDate(customerData.connection_date) : '—');
    }
  }


  /* ══════════════════════════════════════════════
     SUBSCRIPTIONS LOGIC
     ══════════════════════════════════════════════ */

  async function loadSubscriptions() {
    try {
      var { data, error } = await sb.from('customer_subscriptions')
        .select('*, service_plans(*)')
        .eq('customer_id', customerData.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      subscriptions = data || [];
      activeSubscription = subscriptions.find(function (s) { return s.status === 'ACTIVE'; }) || subscriptions[0];

      renderSubscription();

    } catch (err) {
      console.error('Load subscriptions error:', err);
    }
  }

  function renderSubscription() {
    var container = document.getElementById('custSubDetails');
    if (!container) return;

    if (!activeSubscription) {
      container.innerHTML = '<div style="padding:16px 0; color:#64748B;"><div style="font-size:24px; margin-bottom:8px;">📦</div><strong>No Active Subscription</strong><p style="font-size:13px; margin-top:4px;">You currently do not have an active service subscription. Contact your operator or check Available Plans.</p></div>';
      document.getElementById('custHeroExpiry').textContent = 'No active plan';
      document.getElementById('custOverviewSubStatus').textContent = 'INACTIVE';
      document.getElementById('custOverviewPrice').textContent = '—';
      return;
    }

    var plan = activeSubscription.service_plans;
    var priceStr = plan ? '₹' + plan.price + ' / ' + plan.duration + ' ' + plan.duration_unit.toLowerCase() : '—';
    var speedOrChannels = plan ? (plan.speed_mbps ? plan.speed_mbps + ' Mbps' : (plan.channel_count ? plan.channel_count + ' Channels' : '—')) : '—';

    document.getElementById('custHeroExpiry').textContent = formatDate(activeSubscription.end_date);
    document.getElementById('custOverviewSubStatus').textContent = activeSubscription.status;
    document.getElementById('custOverviewPrice').textContent = plan ? '₹' + plan.price : '—';

    container.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:16px;">' +
      '<div>' +
      '<div style="font-family:\'Space Grotesk\',sans-serif; font-size:20px; font-weight:700;">' + esc(plan ? plan.name : (customerData.plan_name || 'Subscribed Plan')) + '</div>' +
      '<div style="margin-top:4px; font-size:13px; color:#64748B;">Category: ' + esc(plan ? plan.service_type : customerData.service_type) + '</div>' +
      '</div>' +
      '<div>' + renderStatusBadge(activeSubscription.status) + '</div>' +
      '</div>' +

      '<div class="cust-grid">' +
      detailField('Pricing', priceStr) +
      detailField('Speed / Features', speedOrChannels) +
      detailField('Start Date', formatDate(activeSubscription.start_date)) +
      detailField('Expiry / End Date', formatDate(activeSubscription.end_date)) +
      '</div>' +

      (activeSubscription.notes ? '<div style="margin-top:14px; font-size:13px; color:#64748B;">Notes: ' + esc(activeSubscription.notes) + '</div>' : '');
  }


  /* ══════════════════════════════════════════════
     AVAILABLE PLANS LOGIC
     ══════════════════════════════════════════════ */

  async function loadAvailablePlans() {
    if (!customerData.lco_id) return;

    try {
      var { data, error } = await sb.from('service_plans')
        .select('*')
        .eq('lco_id', customerData.lco_id)
        .eq('status', 'ACTIVE')
        .order('price', { ascending: true });

      if (error) throw error;
      availablePlans = data || [];

      renderAvailablePlans();

    } catch (err) {
      console.error('Load available plans error:', err);
    }
  }

  function renderAvailablePlans() {
    var container = document.getElementById('custAvailablePlansGrid');
    if (!container) return;

    if (availablePlans.length === 0) {
      container.innerHTML = '<div style="grid-column:1/-1; padding:32px; text-align:center; color:#64748B;"><div style="font-size:28px; margin-bottom:8px;">🏷️</div><h3>No active plans listed</h3><p>Your operator has not published plans yet. Please contact them directly.</p></div>';
      return;
    }

    container.innerHTML = availablePlans.map(function (plan) {
      var durationStr = plan.duration + ' ' + plan.duration_unit.toLowerCase();

      var featuresHtml = '';
      if (plan.speed_mbps) featuresHtml += '<div class="cust-plan-feature">⚡ ' + plan.speed_mbps + ' Mbps Speed</div>';
      if (plan.data_limit_gb) featuresHtml += '<div class="cust-plan-feature">📊 ' + plan.data_limit_gb + ' GB Data</div>';
      else if (plan.service_type === 'Broadband') featuresHtml += '<div class="cust-plan-feature">📊 Unlimited Data</div>';
      if (plan.channel_count) featuresHtml += '<div class="cust-plan-feature">📺 ' + plan.channel_count + ' Channels</div>';
      if (plan.package_type) featuresHtml += '<div class="cust-plan-feature">📡 ' + esc(plan.package_type) + '</div>';

      return '<div class="cust-plan-card">' +
        '<div>' +
        '<div class="cust-plan-name">' + esc(plan.name) + '</div>' +
        '<div style="font-size:12px; color:#64748B;">Category: ' + esc(plan.service_type) + '</div>' +
        '<div class="cust-plan-price">₹' + plan.price + ' <span>/ ' + durationStr + '</span></div>' +
        (plan.description ? '<div style="font-size:13px; color:#64748B; margin-bottom:12px;">' + esc(plan.description) + '</div>' : '') +
        featuresHtml +
        '</div>' +
        '<button class="cust-plan-btn req-plan-btn" data-id="' + plan.id + '" data-name="' + esc(plan.name) + '">Request Plan / Upgrade</button>' +
        '</div>';
    }).join('');

    container.querySelectorAll('.req-plan-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openRequestPlanModal(btn.dataset.id, btn.dataset.name);
      });
    });
  }


  /* ══════════════════════════════════════════════
     REQUEST PLAN MODAL
     ══════════════════════════════════════════════ */

  function setupRequestPlanModal() {
    var modal = document.getElementById('requestPlanModal');
    var form = document.getElementById('requestPlanForm');
    var cancelBtn = document.getElementById('cancelReqPlanBtn');

    if (!modal || !form) return;

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var planId = document.getElementById('reqPlanId').value;
      var planName = document.getElementById('reqPlanName').value;
      var notes = document.getElementById('reqPlanNotes').value.trim();

      var confirmBtn = document.getElementById('confirmReqPlanBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Sending…';

      try {
        // Create notification for LCO Admin
        var { error } = await sb.from('notifications')
          .insert({
            lco_id: customerData.lco_id,
            customer_id: null,
            technician_id: null,
            recipient_role: 'LCO_ADMIN',
            title: 'Plan Request from Customer',
            message: customerData.full_name + ' (' + customerData.customer_id + ') has requested the plan "' + planName + '". Notes: ' + (notes || 'None'),
            type: 'INFO'
          });

        if (error) throw error;

        showToast('Plan request sent to your operator!', 'success');
        modal.classList.remove('visible');
        form.reset();

      } catch (err) {
        console.error('Request plan error:', err);
        showToast('Failed to send request.', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Send Request';
      }
    });
  }

  function openRequestPlanModal(planId, planName) {
    var modal = document.getElementById('requestPlanModal');
    document.getElementById('reqPlanId').value = planId;
    document.getElementById('reqPlanName').value = planName;
    document.getElementById('reqPlanNotes').value = '';
    modal.classList.add('visible');
  }


  /* ══════════════════════════════════════════════
     BILLING & PAYMENTS LOGIC
     ══════════════════════════════════════════════ */

  async function loadBillingData() {
    if (!customerData) return;

    try {
      // 1. Fetch bills
      var { data: bills, error: billsErr } = await sb.from('customer_bills')
        .select('*')
        .eq('customer_id', customerData.id)
        .order('created_at', { ascending: false });

      if (billsErr) throw billsErr;
      billingHistory = bills || [];

      // Find first pending/overdue bill
      activeBill = billingHistory.find(function (b) { return b.status === 'PENDING' || b.status === 'OVERDUE'; }) || null;

      // 2. Fetch payments
      var { data: payments, error: payErr } = await sb.from('customer_payments')
        .select('*')
        .eq('customer_id', customerData.id)
        .order('payment_date', { ascending: false });

      if (payErr) throw payErr;
      paymentHistory = payments || [];

      // 3. Render views
      renderOutstandingBill();
      renderBillingHistory();
      renderPaymentHistory();

    } catch (err) {
      console.error('Load billing data error:', err);
      showToast('Failed to load billing information.', 'error');
    }
  }

  function renderOutstandingBill() {
    var card = document.getElementById('custOutstandingBillCard');
    var noBill = document.getElementById('custNoBillMessage');
    var badge = document.getElementById('custBillStatusBadge');
    var grid = document.getElementById('custBillDetailGrid');

    if (!card || !noBill || !grid) return;

    if (!activeBill) {
      card.style.display = 'none';
      noBill.style.display = 'block';
      return;
    }

    noBill.style.display = 'none';
    card.style.display = 'block';

    if (badge) badge.innerHTML = renderStatusBadge(activeBill.status);

    var outstanding = Number(activeBill.amount) - Number(activeBill.paid_amount);

    grid.innerHTML =
      detailField('Bill Number', activeBill.bill_number) +
      detailField('Plan Name', activeBill.plan_name) +
      detailField('Total Amount', '₹' + Number(activeBill.amount).toFixed(2)) +
      detailField('Paid Amount', '₹' + Number(activeBill.paid_amount).toFixed(2)) +
      detailField('Amount Due', '₹' + outstanding.toFixed(2)) +
      detailField('Billing Period', formatDate(activeBill.billing_period_start) + ' to ' + formatDate(activeBill.billing_period_end)) +
      detailField('Due Date', formatDate(activeBill.due_date)) +
      (activeBill.notes ? detailField('Notes', activeBill.notes) : '');
  }

  function renderBillingHistory() {
    var tbody = document.getElementById('custBillingHistoryBody');
    if (!tbody) return;

    if (billingHistory.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:#64748B;">No bills found.</td></tr>';
      return;
    }

    tbody.innerHTML = billingHistory.map(function (b) {
      return '<tr>' +
        '<td><strong>' + esc(b.bill_number) + '</strong></td>' +
        '<td>' + esc(b.plan_name) + '</td>' +
        '<td>' + formatDate(b.billing_period_start) + ' - ' + formatDate(b.billing_period_end) + '</td>' +
        '<td>₹' + Number(b.amount).toFixed(2) + '</td>' +
        '<td>₹' + Number(b.paid_amount).toFixed(2) + '</td>' +
        '<td>' + formatDate(b.due_date) + '</td>' +
        '<td>' + renderStatusBadge(b.status) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderPaymentHistory() {
    var tbody = document.getElementById('custPaymentHistoryBody');
    if (!tbody) return;

    if (paymentHistory.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:24px; color:#64748B;">No payments recorded.</td></tr>';
      return;
    }

    tbody.innerHTML = paymentHistory.map(function (p) {
      return '<tr>' +
        '<td><strong>' + esc(p.payment_number) + '</strong></td>' +
        '<td>₹' + Number(p.amount).toFixed(2) + '</td>' +
        '<td><span class="cust-badge">' + esc(p.payment_method) + '</span></td>' +
        '<td>' + formatDate(p.payment_date) + '</td>' +
        '<td>' + esc(p.transaction_reference || '—') + '</td>' +
        '<td><span class="cust-badge active">COMPLETED</span></td>' +
        '</tr>';
    }).join('');
  }

  function setupPayNow() {
    var payBtn = document.getElementById('custPayNowBtn');
    if (!payBtn) return;

    payBtn.addEventListener('click', handlePayNow);
  }

  async function handlePayNow() {
    if (!activeBill) {
      showToast('No outstanding bill to pay.', 'warning');
      return;
    }

    var payBtn = document.getElementById('custPayNowBtn');
    var procEl = document.getElementById('custPaymentProcessing');

    payBtn.disabled = true;
    if (procEl) procEl.style.display = 'inline-block';

    try {
      // Create payment order via Edge Function
      var res = await sb.functions.invoke('create-payment-order', {
        body: { bill_id: activeBill.id }
      });

      if (!res.data || !res.data.ok) {
        throw new Error(res.data?.error || res.error?.message || 'Failed to initiate payment.');
      }

      var resData = res.data;

      // Check if Cashfree Web Checkout SDK is available
      if (typeof window.Cashfree === 'undefined') {
        showToast('Online payment gateway is currently loading. Please refresh the page and try again.', 'error');
        return;
      }

      // Initialize Cashfree in Sandbox mode
      var cashfree = window.Cashfree({ mode: 'sandbox' });

      // Trigger Cashfree Hosted Checkout
      var checkoutOptions = {
        paymentSessionId: resData.payment_session_id,
        redirectTarget: '_modal'
      };

      var checkoutResult = await cashfree.checkout(checkoutOptions);

      if (checkoutResult && checkoutResult.error) {
        showToast('Payment cancelled or failed: ' + (checkoutResult.error.message || 'Cancelled'), 'warning');
      }

      // Server-side verification (never trust client result alone)
      showToast('Verifying payment with gateway…', 'info');
      try {
        var vRes = await sb.functions.invoke('verify-payment', {
          body: {
            order_id: resData.order_id,
            bill_id: resData.bill.id
          }
        });

        if (vRes.data && vRes.data.ok) {
          showToast('Payment verified successfully! Receipt #: ' + (vRes.data.payment_number || ''), 'success');
          loadBillingData();
          loadNotifications();
        } else {
          showToast(vRes.data?.error || 'Payment verification pending. Refresh in a moment.', 'warning');
        }
      } catch (vErr) {
        console.error('Verify payment error:', vErr);
        showToast('Verification check failed. Webhook will record if payment succeeded.', 'warning');
      }

    } catch (err) {
      console.error('Pay Now error:', err);
      showToast(err.message || 'Payment processing error.', 'error');
    } finally {
      payBtn.disabled = false;
      if (procEl) procEl.style.display = 'none';
    }
  }


  /* ══════════════════════════════════════════════
     NOTIFICATIONS LOGIC
     ══════════════════════════════════════════════ */

  /* ══════════════════════════════════════════════
     NOTIFICATIONS LOGIC (Phase 11 Batch 1)
     ══════════════════════════════════════════════ */

  var custNotifCategoryFilter = 'ALL';
  var custNotifStatusFilter = 'ALL';

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

  function getCustCategoryMeta(cat) {
    switch (cat) {
      case 'ACCOUNT': return { label: 'Account', icon: '👤' };
      case 'SERVICE_REQUEST': return { label: 'Service Request', icon: '🛠️' };
      case 'PAYMENT': return { label: 'Payment', icon: '💳' };
      case 'ANNOUNCEMENT': return { label: 'Announcement', icon: '📢' };
      default: return { label: 'General', icon: '💬' };
    }
  }

  function setupNotificationCenterListeners() {
    var catGroup = document.getElementById('custNotifCategoryFilter');
    if (catGroup) {
      catGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          catGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          custNotifCategoryFilter = btn.dataset.cat || 'ALL';
          loadNotifications();
        });
      });
    }

    var statusGroup = document.getElementById('custNotifStatusFilter');
    if (statusGroup) {
      statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          statusGroup.querySelectorAll('.lco-filter-btn').forEach(function(b) { b.classList.remove('active'); });
          btn.classList.add('active');
          custNotifStatusFilter = btn.dataset.status || 'ALL';
          loadNotifications();
        });
      });
    }

    var markAllBtn = document.getElementById('custMarkAllReadBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', markAllNotificationsRead);
    }

    var togglePrefBtn = document.getElementById('custTogglePrefBtn');
    var closePrefBtn = document.getElementById('custClosePrefBtn');
    var prefCard = document.getElementById('custNotifPrefCard');
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

    var savePrefBtn = document.getElementById('custSavePrefBtn');
    if (savePrefBtn) {
      savePrefBtn.addEventListener('click', saveNotificationPreferences);
    }

    setupCustomerNotifSubTabs();
  }

  var activeCustNotifSubTab = 'feed';

  function setupCustomerNotifSubTabs() {
    var subTabBtns = document.querySelectorAll('.lco-sub-tab-btn[data-cust-notif-tab]');
    subTabBtns.forEach(function(btn) {
      btn.addEventListener('click', function() {
        subTabBtns.forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        activeCustNotifSubTab = btn.dataset.custNotifTab;

        var feedWrap = document.getElementById('custNotifTabFeedContainer');
        var historyWrap = document.getElementById('custNotifTabHistoryContainer');

        if (feedWrap) feedWrap.style.display = (activeCustNotifSubTab === 'feed') ? 'block' : 'none';
        if (historyWrap) historyWrap.style.display = (activeCustNotifSubTab === 'history') ? 'block' : 'none';

        if (activeCustNotifSubTab === 'feed') {
          loadNotifications();
        } else if (activeCustNotifSubTab === 'history') {
          loadCustomerCommunicationHistory();
        }
      });
    });

    var catSel = document.getElementById('custCommCategorySelect');
    if (catSel) {
      catSel.addEventListener('change', function() {
        if (activeCustNotifSubTab === 'history') loadCustomerCommunicationHistory();
      });
    }

    var searchInput = document.getElementById('custCommSearchInput');
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function() {
          if (activeCustNotifSubTab === 'history') loadCustomerCommunicationHistory();
        }, 300);
      });
    }
  }

  async function loadCustomerCommunicationHistory() {
    var body = document.getElementById('custCommHistoryBody');
    if (!body) return;
    body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:var(--slate);">Loading communication history…</td></tr>';

    var category = document.getElementById('custCommCategorySelect') ? document.getElementById('custCommCategorySelect').value : 'ALL';
    var search = document.getElementById('custCommSearchInput') ? document.getElementById('custCommSearchInput').value.trim() : '';

    try {
      var { data, error } = await sb.rpc('get_customer_communication_history', {
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
      console.error('Load customer communication history error:', e);
      body.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:32px; color:#DC2626;">Failed to load communication history.</td></tr>';
    }
  }

  function renderCategoryBadge(cat) {
    var cls = 'default';
    if (cat === 'ACCOUNT') cls = 'account';
    else if (cat === 'SERVICE_REQUEST') cls = 'service';
    else if (cat === 'PAYMENT') cls = 'payment';
    else if (cat === 'ANNOUNCEMENT') cls = 'announcement';
    return '<span class="lco-notif-cat-badge ' + cls + '">' + esc(cat) + '</span>';
  }

  function renderChannelBadge(ch) {
    var bg = '#E2E8F0', color = '#334155';
    if (ch === 'In-App Feed') { bg = '#E0F2FE'; color = '#0369A1'; }
    else if (ch === 'Email Invite (Sent/Attempted)') { bg = '#FEF3C7'; color = '#92400E'; }
    else if (ch === 'Urgent Notice Banner') { bg = '#FEE2E2'; color = '#991B1B'; }
    return '<span style="display:inline-block; padding:3px 8px; border-radius:12px; font-size:11px; font-weight:600; background:' + bg + '; color:' + color + ';">' + esc(ch) + '</span>';
  }

  function renderCommStatusBadge(status) {
    var bg = '#F1F5F9', color = '#475569';
    var st = (status || '').toUpperCase();
    if (st === 'READ' || st === 'ACTIVATED' || st === 'ACTIVE') { bg = '#DCFCE7'; color = '#166534'; }
    else if (st === 'UNREAD' || st === 'INVITED' || st === 'PENDING') { bg = '#FEF9C3'; color = '#854D0E'; }
    else if (st === 'FAILED' || st === 'EXPIRED' || st === 'INACTIVE' || st === 'DISMISSED') { bg = '#FEE2E2'; color = '#991B1B'; }
    return '<span style="display:inline-block; padding:2px 8px; border-radius:4px; font-size:11px; font-weight:700; background:' + bg + '; color:' + color + ';">' + esc(status || '—') + '</span>';
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

  async function loadNotifications() {
    var container = document.getElementById('custNotifList');
    if (!container) return;

    try {
      var query = sb.from('notifications')
        .select('*')
        .eq('lco_id', customerData.lco_id)
        .eq('customer_id', customerData.id)
        .eq('recipient_role', 'CUSTOMER');

      if (custNotifCategoryFilter !== 'ALL') {
        query = query.eq('category', custNotifCategoryFilter);
      }
      if (custNotifStatusFilter === 'UNREAD') {
        query = query.eq('is_read', false);
      } else if (custNotifStatusFilter === 'READ') {
        query = query.eq('is_read', true);
      }

      var { data, error } = await query.order('created_at', { ascending: false }).limit(50);
      if (error) throw error;

      notifications = data || [];

      // Update total unread count badge
      var { count: unreadCount } = await sb.from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('lco_id', customerData.lco_id)
        .eq('customer_id', customerData.id)
        .eq('recipient_role', 'CUSTOMER')
        .eq('is_read', false);

      var badge = document.getElementById('custNotifCount');
      if (badge) {
        badge.textContent = unreadCount || 0;
        badge.style.display = (unreadCount && unreadCount > 0) ? '' : 'none';
      }

      if (notifications.length === 0) {
        container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">🔔</div><h3>No notifications</h3><p>You\'re all caught up!</p></div>';
        return;
      }

      container.innerHTML = notifications.map(function (n) {
        var catMeta = getCustCategoryMeta(n.category);
        return '<div class="lco-notif-item' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
          '<div class="lco-notif-dot' + (n.is_read ? ' read' : '') + '"></div>' +
          '<span class="lco-notif-icon">' + catMeta.icon + '</span>' +
          '<div class="lco-notif-body">' +
          '<div class="lco-notif-title">' + esc(n.title) +
          '<span class="lco-notif-cat-badge cat-' + (n.category || 'ACCOUNT') + '">' + esc(catMeta.label) + '</span>' +
          '</div>' +
          '<div class="lco-notif-message">' + esc(n.message) + '</div>' +
          '<div class="lco-notif-time">' + formatTimeAgo(n.created_at) + ' • ' + formatDate(n.created_at) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

      container.querySelectorAll('.lco-notif-item.unread').forEach(function (item) {
        item.addEventListener('click', function () {
          markNotificationRead(item.dataset.id);
          item.classList.remove('unread');
          var dot = item.querySelector('.lco-notif-dot');
          if (dot) dot.classList.add('read');
        });
      });

    } catch (err) {
      console.error('Load notifications error:', err);
      container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">⚠️</div><h3>Unable to load notifications</h3><button class="lco-quick-btn secondary" style="margin-top:12px;" onclick="loadNotifications()">Retry</button></div>';
    }
  }

  async function markNotificationRead(notifId) {
    try {
      await sb.from('notifications')
        .update({ is_read: true })
        .eq('id', notifId)
        .eq('customer_id', customerData.id)
        .eq('recipient_role', 'CUSTOMER');

      var badge = document.getElementById('custNotifCount');
      if (badge) {
        var current = parseInt(badge.textContent) || 0;
        var newCount = Math.max(0, current - 1);
        badge.textContent = newCount;
        badge.style.display = newCount > 0 ? '' : 'none';
      }
    } catch (e) {
      console.error('Mark customer notification read error:', e);
    }
  }

  async function markAllNotificationsRead() {
    try {
      var { error } = await sb.from('notifications')
        .update({ is_read: true })
        .eq('lco_id', customerData.lco_id)
        .eq('customer_id', customerData.id)
        .eq('recipient_role', 'CUSTOMER')
        .eq('is_read', false);

      if (error) throw error;
      showToast('All notifications marked as read', 'success');
      loadNotifications();
    } catch (e) {
      console.error('Customer mark all read error:', e);
      showToast('Failed to mark all as read', 'error');
    }
  }

  async function loadNotificationPreferences() {
    var form = document.getElementById('custPrefForm');
    if (!form) return;
    form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:var(--slate);">Loading preferences…</div>';

    try {
      var { data, error } = await sb.rpc('get_my_notification_preferences', { p_role: 'CUSTOMER' });
      if (error) throw error;

      var prefs = data || [];
      var categoryDescriptions = {
        'ACCOUNT': 'Account activation, security, and profile change alerts.',
        'SERVICE_REQUEST': 'Service request progress updates and resolution notes.',
        'PAYMENT': 'Payment receipts, bill invoices, and payment reminders.',
        'ANNOUNCEMENT': 'Broadband & cable provider service announcements and offers.'
      };

      form.innerHTML = prefs.map(function(pref) {
        var catMeta = getCustCategoryMeta(pref.category);
        var desc = categoryDescriptions[pref.category] || 'Channel preferences for this category.';
        var isMandatory = (pref.category === 'ACCOUNT');

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
      console.error('Load customer preferences error:', e);
      form.innerHTML = '<div style="grid-column:1/-1; padding:20px; text-align:center; color:#E74C3C;">Failed to load preferences.</div>';
    }
  }

  async function saveNotificationPreferences() {
    var saveBtn = document.getElementById('custSavePrefBtn');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
    }

    try {
      var form = document.getElementById('custPrefForm');
      var updatedPrefs = [];
      form.querySelectorAll('.lco-pref-card').forEach(function(card) {
        var cat = card.dataset.cat;
        var inApp = card.querySelector('.pref-in-app').checked;
        var email = card.querySelector('.pref-email').checked;
        updatedPrefs.push({ category: cat, channel_in_app: inApp, channel_email: email });
      });

      var { data, error } = await sb.rpc('save_my_notification_preferences', {
        p_role: 'CUSTOMER',
        p_preferences: updatedPrefs
      });

      if (error) throw error;
      showToast('Notification preferences saved!', 'success');
      document.getElementById('custNotifPrefCard').style.display = 'none';
    } catch (e) {
      console.error('Save customer preferences error:', e);
      showToast('Failed to save preferences', 'error');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Preferences';
      }
    }
  }

  /* ══════════════════════════════════════════════
     SERVICE REQUESTS LOGIC
     ══════════════════════════════════════════════ */

  async function loadCustomerRequests() {
    var tbody = document.getElementById('custRequestsTableBody');
    if (!customerData) return;

    try {
      var { data, error } = await sb.from('service_requests')
        .select('*')
        .eq('customer_id', customerData.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      customerRequests = data || [];

      // Update badge count for open/in_progress requests
      var activeCount = customerRequests.filter(function (r) {
        return r.status === 'OPEN' || r.status === 'IN_PROGRESS';
      }).length;

      var badge = document.getElementById('custRequestsCount');
      if (badge) {
        badge.textContent = activeCount;
        badge.style.display = activeCount > 0 ? '' : 'none';
      }

      renderCustomerRequestsList();

    } catch (err) {
      console.error('Load service requests error:', err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:24px; color:#EF4444;">Failed to load service requests.</td></tr>';
      }
    }
  }

  function renderCustomerRequestsList() {
    var tbody = document.getElementById('custRequestsTableBody');
    if (!tbody) return;

    if (customerRequests.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#64748B;">' +
        '<div style="font-size:24px; margin-bottom:6px;">🛠️</div>' +
        '<strong>No service requests raised yet</strong>' +
        '<p style="font-size:12px; margin-top:4px;">Have an issue with your signal or internet? Click "+ Raise Service Request" above.</p>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = customerRequests.map(function (req) {
      return '<tr>' +
        '<td data-label="Ticket #"><strong>' + esc(req.request_id) + '</strong></td>' +
        '<td data-label="Category">' + esc(formatReqCategory(req.category)) + '</td>' +
        '<td data-label="Subject"><div style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + esc(req.subject) + '">' + esc(req.subject) + '</div></td>' +
        '<td data-label="Priority">' + renderReqPriorityBadge(req.priority) + '</td>' +
        '<td data-label="Status">' + renderReqStatusBadge(req.status) + '</td>' +
        '<td data-label="Date Raised">' + formatDate(req.created_at) + '</td>' +
        '<td data-label="Action"><button class="lco-action-btn view-req-detail-btn" data-id="' + req.id + '">View Details</button></td>' +
        '</tr>';
    }).join('');

    tbody.querySelectorAll('.view-req-detail-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var req = customerRequests.find(function (r) { return r.id === btn.dataset.id; });
        if (req) openCustReqDetailModal(req);
      });
    });
  }

  function setupCreateRequestModal() {
    var modal = document.getElementById('createRequestModal');
    var openBtn = document.getElementById('openCreateRequestBtn');
    var cancelBtn = document.getElementById('cancelCreateReqBtn');
    var form = document.getElementById('createRequestForm');

    if (!modal || !form) return;

    if (openBtn) {
      openBtn.addEventListener('click', function () {
        form.reset();
        modal.classList.add('visible');
      });
    }

    if (cancelBtn) {
      cancelBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      var category = document.getElementById('custReqCategory').value;
      var subject = document.getElementById('custReqSubject').value.trim();
      var description = document.getElementById('custReqDescription').value.trim();

      if (!subject || !description) {
        showToast('Please fill in all required fields.', 'error');
        return;
      }

      var confirmBtn = document.getElementById('confirmCreateReqBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="lco-spinner"></span> Submitting…';

      try {
        // Insert service request (Note: Customer priority automatically defaults to MEDIUM database-side)
        var { data, error } = await sb.from('service_requests')
          .insert({
            lco_id: customerData.lco_id,
            customer_id: customerData.id,
            category: category,
            subject: subject,
            description: description
          })
          .select()
          .single();

        if (error) throw error;

        showToast('Service request ' + (data ? data.request_id : '') + ' submitted successfully!', 'success');
        modal.classList.remove('visible');
        form.reset();

        // Refresh request list and notifications
        loadCustomerRequests();
        loadNotifications();

      } catch (err) {
        console.error('Create service request error:', err);
        showToast(err.message || 'Failed to submit service request.', 'error');
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Submit Request';
      }
    });
  }

  function setupCustReqDetailModal() {
    var modal = document.getElementById('custReqDetailModal');
    var closeBtn = document.getElementById('closeCustReqDetailBtn');

    if (closeBtn && modal) {
      closeBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }
  }

  function openCustReqDetailModal(req) {
    var modal = document.getElementById('custReqDetailModal');
    if (!modal) return;

    document.getElementById('custReqDetailId').textContent = req.request_id;
    document.getElementById('custReqDetailCategory').textContent = formatReqCategory(req.category);
    document.getElementById('custReqDetailSubject').textContent = req.subject;
    document.getElementById('custReqDetailDescription').textContent = req.description;
    document.getElementById('custReqDetailDate').textContent = 'Raised on: ' + formatDate(req.created_at);

    var badgesEl = document.getElementById('custReqDetailBadges');
    if (badgesEl) {
      badgesEl.innerHTML = renderReqPriorityBadge(req.priority) + ' ' + renderReqStatusBadge(req.status);
    }

    // Operator Resolution Notes
    var resSection = document.getElementById('custReqDetailResolutionSection');
    var resNotes = document.getElementById('custReqDetailResolutionNotes');
    if (resSection && resNotes) {
      if (req.resolution_notes) {
        resNotes.textContent = req.resolution_notes;
        resSection.style.display = 'block';
      } else {
        resSection.style.display = 'none';
      }
    }

    // Assigned Technician Info
    var techSection = document.getElementById('custReqDetailTechSection');
    var techInfo = document.getElementById('custReqDetailTechInfo');
    if (techSection && techInfo) {
      if (req.assigned_technician_name) {
        techInfo.innerHTML = '<strong>Name:</strong> ' + esc(req.assigned_technician_name) +
          (req.assigned_technician_phone ? ' | <strong>Phone:</strong> ' + esc(req.assigned_technician_phone) : '') +
          (req.technician_notes ? '<div style="margin-top:4px; font-size:12px; color:#64748B;">Notes: ' + esc(req.technician_notes) + '</div>' : '');
        techSection.style.display = 'block';
      } else {
        techSection.style.display = 'none';
      }
    }

    // Cancel Button Action (only visible if status is OPEN)
    var cancelActionBtn = document.getElementById('custCancelReqActionBtn');
    if (cancelActionBtn) {
      if (req.status === 'OPEN') {
        cancelActionBtn.style.display = 'inline-block';
        cancelActionBtn.onclick = async function () {
          if (!confirm('Are you sure you want to cancel this service request?')) return;

          cancelActionBtn.disabled = true;
          try {
            var { error } = await sb.from('service_requests')
              .update({ status: 'CANCELLED' })
              .eq('id', req.id);

            if (error) throw error;

            showToast('Service request ' + req.request_id + ' cancelled.', 'info');
            modal.classList.remove('visible');
            loadCustomerRequests();
            loadNotifications();
          } catch (cErr) {
            console.error('Cancel request error:', cErr);
            showToast(cErr.message || 'Failed to cancel request.', 'error');
          } finally {
            cancelActionBtn.disabled = false;
          }
        };
      } else {
        cancelActionBtn.style.display = 'none';
      }
    }

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
     UTILITIES & HELPERS
     ══════════════════════════════════════════════ */

  function detailField(label, value) {
    return '<div class="cust-profile-field">' +
      '<div class="cust-field-label">' + esc(label) + '</div>' +
      '<div class="cust-field-val">' + esc(value || '—') + '</div>' +
      '</div>';
  }

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function renderStatusBadge(status) {
    var cls = 'active';
    var st = status || 'ACTIVE';
    if (st === 'INACTIVE') cls = 'inactive';
    else if (st === 'EXPIRED') cls = 'expired';
    else if (st === 'PENDING') cls = 'pending';
    return '<span class="cust-badge ' + cls + '">' + st + '</span>';
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

  function showToast(message, type) {
    var container = document.getElementById('custToastContainer');
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
     BOOTSTRAP
     ══════════════════════════════════════════════ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth);
  } else {
    initAuth();
  }

})();
