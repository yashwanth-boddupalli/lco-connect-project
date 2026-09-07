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
        showToast('Unable to load customer profile. Please contact your operator.', 'error');
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

    // Render overview
    renderOverview();

    // Load data async
    loadSubscriptions();
    loadAvailablePlans();
    loadNotifications();
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
    } else if (viewName === 'profile') {
      renderProfile();
    } else if (viewName === 'service') {
      renderService();
    } else if (viewName === 'subscription') {
      renderSubscription();
    } else if (viewName === 'plans') {
      renderAvailablePlans();
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
     NOTIFICATIONS LOGIC
     ══════════════════════════════════════════════ */

  async function loadNotifications() {
    var container = document.getElementById('custNotifList');
    if (!container) return;

    try {
      var { data, error } = await sb.from('notifications')
        .select('*')
        .or('customer_id.eq.' + customerData.id + ',and(lco_id.eq.' + customerData.lco_id + ',customer_id.is.null)')
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      notifications = data || [];

      // Update badge
      var unread = notifications.filter(function (n) { return !n.is_read; }).length;
      var badge = document.getElementById('custNotifCount');
      if (badge) {
        badge.textContent = unread;
        badge.style.display = unread > 0 ? '' : 'none';
      }

      if (notifications.length === 0) {
        container.innerHTML = '<div class="lco-empty"><div class="lco-empty-icon">🔔</div><h3>No notifications</h3><p>You\'re all caught up!</p></div>';
        return;
      }

      container.innerHTML = notifications.map(function (n) {
        var icon = n.type === 'SUCCESS' ? '✅' : n.type === 'WARNING' ? '⚠️' : 'ℹ️';

        return '<div class="lco-notif-item' + (n.is_read ? '' : ' unread') + '" data-id="' + n.id + '">' +
          '<div class="lco-notif-dot' + (n.is_read ? ' read' : '') + '"></div>' +
          '<span class="lco-notif-icon">' + icon + '</span>' +
          '<div class="lco-notif-body">' +
          '<div class="lco-notif-title">' + esc(n.title) + '</div>' +
          '<div class="lco-notif-message">' + esc(n.message) + '</div>' +
          '<div class="lco-notif-time">' + formatDate(n.created_at) + '</div>' +
          '</div>' +
          '</div>';
      }).join('');

    } catch (err) {
      console.error('Load notifications error:', err);
    }
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
