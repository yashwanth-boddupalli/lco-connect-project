/* ============================================
   LCO CONNECT — Super Admin Dashboard Logic
   Phase 2: Super Admin Dashboard
   ============================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     SUPABASE INITIALIZATION
     ══════════════════════════════════════════════ */

  var SUPABASE_URL = 'https://qlidbycuvuurnalbvfcc.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_LpSmIK-o-DO1_-fKIQ7yWg_VYbVddGC';
  var sb = null;

  try {
    if (window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) {
    console.error('Supabase init failed:', e);
  }


  /* ══════════════════════════════════════════════
     STATE
     ══════════════════════════════════════════════ */

  var currentUser = null;
  var currentView = 'overview';
  var allApplications = [];
  var currentDetailApp = null;
  var currentDetailDocs = [];
  var currentFilter = 'all';
  var currentSearch = '';
  var pendingDocRejectId = null;


  /* ══════════════════════════════════════════════
     AUTH GUARD
     ══════════════════════════════════════════════ */

  async function initAuth() {
    if (!sb) {
      showToast('Connection unavailable. Please refresh.', 'error');
      return;
    }

    try {
      var { data: sessionData, error: sessionError } = await sb.auth.getSession();

      if (sessionError || !sessionData.session) {
        redirectToLogin();
        return;
      }

      // Verify role
      var { data: profile, error: profileError } = await sb.from('profiles')
        .select('role, email')
        .eq('id', sessionData.session.user.id)
        .single();

      if (profileError || !profile || profile.role !== 'SUPER_ADMIN') {
        await sb.auth.signOut();
        redirectToLogin();
        return;
      }

      currentUser = {
        id: sessionData.session.user.id,
        email: profile.email || sessionData.session.user.email,
        role: profile.role
      };

      // Show dashboard
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('dashboardContainer').style.display = 'block';
      document.getElementById('adminEmail').textContent = currentUser.email;

      // Initialize dashboard
      initDashboard();

    } catch (e) {
      console.error('Auth check failed:', e);
      redirectToLogin();
    }
  }

  function redirectToLogin() {
    window.location.href = 'super-admin-login.html';
  }


  /* ══════════════════════════════════════════════
     DASHBOARD INITIALIZATION
     ══════════════════════════════════════════════ */

  function initDashboard() {
    setupNavigation();
    setupLogout();
    setupMobileNav();
    setupModals();
    setupSearch();
    setupFilters();
    setupStatCardClicks();

    // Load data
    loadStats();
    loadApplications();
  }


  /* ══════════════════════════════════════════════
     NAVIGATION
     ══════════════════════════════════════════════ */

  function setupNavigation() {
    var navItems = document.querySelectorAll('.sa-nav-item[data-view]');
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
    document.querySelectorAll('.sa-nav-item').forEach(function (item) {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    document.querySelectorAll('.sa-view').forEach(function (view) {
      view.classList.remove('active');
    });
    var targetView = document.getElementById('view-' + viewName);
    if (targetView) targetView.classList.add('active');

    // Load data for specific views
    if (viewName === 'overview') {
      loadStats();
      loadRecentApplications();
    } else if (viewName === 'applications') {
      renderApplicationsTable();
    } else if (viewName === 'approved') {
      renderApprovedTable();
    } else if (viewName === 'rejected') {
      renderRejectedTable();
    }

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  /* ══════════════════════════════════════════════
     MOBILE NAVIGATION
     ══════════════════════════════════════════════ */

  function setupMobileNav() {
    var toggleBtn = document.getElementById('mobileNavToggle');
    var sidebar = document.getElementById('sidebar');
    var overlay = document.getElementById('sidebarOverlay');

    toggleBtn.addEventListener('click', function () {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('visible');
    });

    overlay.addEventListener('click', closeMobileNav);
  }

  function closeMobileNav() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
  }


  /* ══════════════════════════════════════════════
     LOGOUT
     ══════════════════════════════════════════════ */

  function setupLogout() {
    document.getElementById('logoutBtn').addEventListener('click', async function () {
      try {
        await sb.auth.signOut();
      } catch (e) { /* ignore */ }
      redirectToLogin();
    });
  }


  /* ══════════════════════════════════════════════
     STAT CARD CLICKS
     ══════════════════════════════════════════════ */

  function setupStatCardClicks() {
    document.getElementById('statTotal').addEventListener('click', function () {
      switchView('applications');
      setFilter('all');
    });
    document.getElementById('statPending').addEventListener('click', function () {
      switchView('applications');
      setFilter('PENDING');
    });
    document.getElementById('statApproved').addEventListener('click', function () {
      switchView('approved');
    });
    document.getElementById('statRejected').addEventListener('click', function () {
      switchView('rejected');
    });
  }


  /* ══════════════════════════════════════════════
     LOAD STATS
     ══════════════════════════════════════════════ */

  async function loadStats() {
    try {
      var { data, error } = await sb.from('lco_applications')
        .select('status');

      if (error) throw error;

      var total = data.length;
      var pending = data.filter(function (a) { return a.status === 'PENDING' || a.status === 'UNDER_REVIEW'; }).length;
      var approved = data.filter(function (a) { return a.status === 'APPROVED'; }).length;
      var rejected = data.filter(function (a) { return a.status === 'REJECTED'; }).length;

      document.getElementById('statTotalValue').textContent = total;
      document.getElementById('statPendingValue').textContent = pending;
      document.getElementById('statApprovedValue').textContent = approved;
      document.getElementById('statRejectedValue').textContent = rejected;

      // Update nav badge
      document.getElementById('navPendingCount').textContent = pending;

    } catch (e) {
      console.error('Load stats error:', e);
      showToast('Failed to load statistics.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     LOAD APPLICATIONS
     ══════════════════════════════════════════════ */

  async function loadApplications() {
    try {
      var { data, error } = await sb.from('lco_applications')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      allApplications = data || [];
      loadRecentApplications();
      renderApplicationsTable();
      renderApprovedTable();
      renderRejectedTable();

    } catch (e) {
      console.error('Load applications error:', e);
      showToast('Failed to load applications.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     RECENT APPLICATIONS (Overview)
     ══════════════════════════════════════════════ */

  function loadRecentApplications() {
    var tbody = document.getElementById('recentTableBody');
    var recent = allApplications.slice(0, 5);

    if (recent.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="sa-empty"><div class="sa-empty-icon">📋</div><h3>No applications yet</h3><p>Applications will appear here once LCOs register.</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = recent.map(function (app) {
      return buildTableRow(app, ['application_id', 'business_name', 'owner_name', 'status', 'created_at', 'action']);
    }).join('');

    attachRowListeners(tbody);
  }


  /* ══════════════════════════════════════════════
     APPLICATIONS TABLE
     ══════════════════════════════════════════════ */

  function renderApplicationsTable() {
    var tbody = document.getElementById('applicationsTableBody');
    var filtered = getFilteredApplications();

    if (filtered.length === 0) {
      var msg = currentSearch ? 'No applications match your search.' : 'No applications found.';
      tbody.innerHTML = '<tr><td colspan="8"><div class="sa-empty"><div class="sa-empty-icon">🔍</div><h3>' + msg + '</h3></div></td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function (app) {
      return buildTableRow(app, ['application_id', 'business_name', 'owner_name', 'services', 'location', 'created_at', 'status', 'action']);
    }).join('');

    attachRowListeners(tbody);
  }


  /* ══════════════════════════════════════════════
     APPROVED TABLE
     ══════════════════════════════════════════════ */

  function renderApprovedTable() {
    var tbody = document.getElementById('approvedTableBody');
    var approved = allApplications.filter(function (a) { return a.status === 'APPROVED'; });

    if (approved.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8"><div class="sa-empty"><div class="sa-empty-icon">✓</div><h3>No approved LCOs yet</h3><p>Approved LCOs will appear here.</p></div></td></tr>';
      return;
    }

    tbody.innerHTML = approved.map(function (app) {
      return buildTableRow(app, ['application_id', 'business_name', 'owner_name', 'services', 'location', 'reviewed_at', 'status', 'action']);
    }).join('');

    attachRowListeners(tbody);
  }


  /* ══════════════════════════════════════════════
     REJECTED TABLE
     ══════════════════════════════════════════════ */

  function renderRejectedTable() {
    var tbody = document.getElementById('rejectedTableBody');
    var rejected = allApplications.filter(function (a) { return a.status === 'REJECTED'; });

    if (rejected.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6"><div class="sa-empty"><div class="sa-empty-icon">📋</div><h3>No rejected applications</h3></div></td></tr>';
      return;
    }

    tbody.innerHTML = rejected.map(function (app) {
      var row = '<tr data-id="' + app.id + '">';
      row += '<td data-label="App ID"><span class="sa-app-id">' + esc(app.application_id) + '</span></td>';
      row += '<td data-label="Business"><span class="sa-biz-name">' + esc(app.business_name) + '</span></td>';
      row += '<td data-label="Owner">' + esc(app.owner_name) + '</td>';
      row += '<td data-label="Reason"><span style="font-size:13px;color:var(--slate);">' + esc(app.review_notes || '—') + '</span></td>';
      row += '<td data-label="Rejected"><span class="sa-date">' + formatDate(app.reviewed_at || app.updated_at) + '</span></td>';
      row += '<td data-label="Action"><button class="sa-view-btn" data-app-id="' + app.id + '">View</button></td>';
      row += '</tr>';
      return row;
    }).join('');

    attachRowListeners(tbody);
  }


  /* ══════════════════════════════════════════════
     TABLE ROW BUILDER
     ══════════════════════════════════════════════ */

  function buildTableRow(app, columns) {
    var row = '<tr data-id="' + app.id + '">';
    columns.forEach(function (col) {
      switch (col) {
        case 'application_id':
          row += '<td data-label="App ID"><span class="sa-app-id">' + esc(app.application_id) + '</span></td>';
          break;
        case 'business_name':
          row += '<td data-label="Business"><span class="sa-biz-name">' + esc(app.business_name) + '</span></td>';
          break;
        case 'owner_name':
          row += '<td data-label="Owner">' + esc(app.owner_name) + '</td>';
          break;
        case 'services':
          var svc = (app.services || []).join(', ');
          row += '<td data-label="Services"><span class="sa-services">' + esc(svc) + '</span></td>';
          break;
        case 'location':
          row += '<td data-label="Location">' + esc(app.city) + ', ' + esc(app.state) + '</td>';
          break;
        case 'created_at':
          row += '<td data-label="Submitted"><span class="sa-date">' + formatDate(app.created_at) + '</span></td>';
          break;
        case 'reviewed_at':
          row += '<td data-label="Date"><span class="sa-date">' + formatDate(app.reviewed_at || app.updated_at) + '</span></td>';
          break;
        case 'status':
          row += '<td data-label="Status">' + renderBadge(app.status) + '</td>';
          break;
        case 'action':
          row += '<td data-label="Action"><button class="sa-view-btn" data-app-id="' + app.id + '">View</button></td>';
          break;
      }
    });
    row += '</tr>';
    return row;
  }


  function attachRowListeners(tbody) {
    tbody.querySelectorAll('.sa-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        openDetail(btn.dataset.appId);
      });
    });
    tbody.querySelectorAll('tr[data-id]').forEach(function (tr) {
      tr.addEventListener('click', function () {
        openDetail(tr.dataset.id);
      });
    });
  }


  /* ══════════════════════════════════════════════
     SEARCH & FILTER
     ══════════════════════════════════════════════ */

  function setupSearch() {
    var searchInput = document.getElementById('searchInput');
    var debounceTimer;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        currentSearch = searchInput.value.trim().toLowerCase();
        renderApplicationsTable();
      }, 250);
    });
  }

  function setupFilters() {
    var filterGroup = document.getElementById('filterGroup');
    filterGroup.querySelectorAll('.sa-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setFilter(btn.dataset.filter);
      });
    });
  }

  function setFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('#filterGroup .sa-filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    renderApplicationsTable();
  }

  function getFilteredApplications() {
    return allApplications.filter(function (app) {
      // Status filter
      if (currentFilter !== 'all' && app.status !== currentFilter) return false;

      // Search filter
      if (currentSearch) {
        var haystack = [
          app.application_id,
          app.business_name,
          app.owner_name,
          app.email,
          app.city,
          app.state
        ].join(' ').toLowerCase();
        return haystack.indexOf(currentSearch) !== -1;
      }

      return true;
    });
  }


  /* ══════════════════════════════════════════════
     APPLICATION DETAIL VIEW
     ══════════════════════════════════════════════ */

  async function openDetail(appId) {
    // Find application
    var app = allApplications.find(function (a) { return a.id === appId; });
    if (!app) {
      showToast('Application not found.', 'error');
      return;
    }

    currentDetailApp = app;

    // Switch to detail view
    document.querySelectorAll('.sa-view').forEach(function (v) { v.classList.remove('active'); });
    document.getElementById('view-detail').classList.add('active');
    document.querySelectorAll('.sa-nav-item').forEach(function (item) { item.classList.remove('active'); });

    // Populate header
    document.getElementById('detailBizName').textContent = app.business_name;
    document.getElementById('detailAppId').textContent = app.application_id;
    document.getElementById('detailDate').textContent = formatDate(app.created_at);
    document.getElementById('detailStatusBadge').innerHTML = renderBadge(app.status);

    // Action buttons
    var actionsDiv = document.getElementById('detailActions');
    if (app.status === 'PENDING' || app.status === 'UNDER_REVIEW') {
      actionsDiv.innerHTML =
        '<button class="sa-btn-approve" id="approveBtn">✓ Approve LCO</button>' +
        '<button class="sa-btn-reject" id="rejectBtn">✕ Reject</button>';
      document.getElementById('approveBtn').addEventListener('click', function () {
        openApproveModal();
      });
      document.getElementById('rejectBtn').addEventListener('click', function () {
        openRejectModal();
      });
    } else {
      actionsDiv.innerHTML = '';
    }

    // Business info
    var bizGrid = document.getElementById('detailBusinessGrid');
    bizGrid.innerHTML =
      detailField('Business Name', app.business_name) +
      detailField('Owner / Contact', app.owner_name) +
      detailField('Email', app.email) +
      detailField('Phone', app.phone) +
      detailField('Address', app.address, true) +
      detailField('City', app.city) +
      detailField('State', app.state) +
      detailField('PIN Code', app.pincode);

    // Services
    var svcDiv = document.getElementById('detailServices');
    var tags = '<div class="sa-service-tags">';
    (app.services || []).forEach(function (s) {
      tags += '<span class="sa-service-tag">' + esc(s) + '</span>';
    });
    tags += '</div>';
    if (app.other_service_description) {
      tags += '<div style="margin-top:8px;font-size:13px;color:var(--slate);">Other: ' + esc(app.other_service_description) + '</div>';
    }
    svcDiv.innerHTML = tags;

    // Service area
    var areaGrid = document.getElementById('detailAreaGrid');
    areaGrid.innerHTML =
      detailField('Locality', app.service_area_locality, true) +
      detailField('City', app.service_area_city) +
      detailField('State', app.service_area_state) +
      detailField('PIN Code', app.service_area_pincode);
    if (app.service_area_description) {
      areaGrid.innerHTML += detailField('Description', app.service_area_description, true);
    }

    // Audit trail
    var auditSection = document.getElementById('detailAuditSection');
    var auditDiv = document.getElementById('detailAudit');
    if (app.reviewed_at) {
      auditSection.style.display = 'block';
      auditDiv.innerHTML =
        '<div class="sa-audit-row"><strong>Reviewed at</strong> ' + formatDateFull(app.reviewed_at) + '</div>' +
        '<div class="sa-audit-row"><strong>Status</strong> ' + esc(app.status) + '</div>' +
        (app.review_notes ? '<div class="sa-audit-row"><strong>Notes</strong> ' + esc(app.review_notes) + '</div>' : '');
    } else {
      auditSection.style.display = 'none';
    }

    // Load documents
    await loadDocuments(app.id);

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  function detailField(label, value, fullWidth) {
    return '<div class="sa-detail-field' + (fullWidth ? ' full-width' : '') + '">' +
      '<div class="sa-detail-label">' + esc(label) + '</div>' +
      '<div class="sa-detail-value">' + esc(value || '—') + '</div>' +
      '</div>';
  }


  /* ── Back button ── */
  document.getElementById('detailBack').addEventListener('click', function () {
    // Go back to previous view
    switchView(currentView === 'detail' ? 'applications' : currentView || 'applications');
  });


  /* ══════════════════════════════════════════════
     DOCUMENTS
     ══════════════════════════════════════════════ */

  async function loadDocuments(applicationUuid) {
    var container = document.getElementById('detailDocuments');
    container.innerHTML = '<div style="padding:16px;color:var(--slate);font-size:14px;">Loading documents…</div>';

    try {
      var { data, error } = await sb.from('verification_documents')
        .select('*')
        .eq('application_id', applicationUuid)
        .order('created_at', { ascending: true });

      if (error) throw error;

      currentDetailDocs = data || [];

      if (currentDetailDocs.length === 0) {
        container.innerHTML = '<div style="padding:16px;color:var(--slate);font-size:14px;">No documents uploaded.</div>';
        return;
      }

      container.innerHTML = currentDetailDocs.map(function (doc) {
        return renderDocCard(doc);
      }).join('');

      // Attach document event listeners
      attachDocListeners(container);

    } catch (e) {
      console.error('Load documents error:', e);
      container.innerHTML = '<div style="padding:16px;color:#E74C3C;font-size:14px;">Failed to load documents.</div>';
    }
  }


  var DOC_TYPE_LABELS = {
    business_proof: 'Business Proof',
    identity_proof: 'Identity Proof',
    registration_certificate: 'Registration Certificate',
    other_document: 'Other Document'
  };

  function renderDocCard(doc) {
    var isImage = doc.mime_type && doc.mime_type.startsWith('image/');
    var isPdf = doc.mime_type === 'application/pdf';
    var icon = isPdf ? '📑' : isImage ? '🖼️' : '📄';

    var html = '<div class="sa-doc-card" data-doc-id="' + doc.id + '">';
    html += '<div class="sa-doc-info">';
    html += '<span class="sa-doc-icon">' + icon + '</span>';
    html += '<div class="sa-doc-details">';
    html += '<div class="sa-doc-type">' + esc(DOC_TYPE_LABELS[doc.document_type] || doc.document_type) + '</div>';
    html += '<div class="sa-doc-name">' + esc(doc.file_name) + '</div>';
    html += '<div class="sa-doc-meta">' + formatFileSize(doc.file_size) + ' · Uploaded ' + formatDate(doc.created_at) + '</div>';
    html += '</div></div>';

    html += '<div class="sa-doc-actions">';
    html += renderBadge(doc.status);
    html += '<button class="sa-doc-view-btn" data-doc-id="' + doc.id + '" data-path="' + esc(doc.file_path) + '" data-mime="' + esc(doc.mime_type) + '">View</button>';

    // Show verify/reject buttons only for PENDING docs
    if (doc.status === 'PENDING') {
      html += '<button class="sa-doc-status-btn verify" data-doc-id="' + doc.id + '" data-action="verify">✓ Verify</button>';
      html += '<button class="sa-doc-status-btn reject" data-doc-id="' + doc.id + '" data-action="reject">✕ Reject</button>';
    }

    html += '</div>';

    // Show review notes if rejected
    if (doc.status === 'REJECTED' && doc.review_notes) {
      html += '<div style="width:100%;margin-top:8px;padding:8px 12px;background:#FDEDEC;border-radius:8px;font-size:12px;color:#C0392B;">Reason: ' + esc(doc.review_notes) + '</div>';
    }

    html += '</div>';
    return html;
  }


  function attachDocListeners(container) {
    // View document
    container.querySelectorAll('.sa-doc-view-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        viewDocument(btn.dataset.path, btn.dataset.mime);
      });
    });

    // Verify document
    container.querySelectorAll('.sa-doc-status-btn.verify').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        verifyDocument(btn.dataset.docId);
      });
    });

    // Reject document
    container.querySelectorAll('.sa-doc-status-btn.reject').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        pendingDocRejectId = btn.dataset.docId;
        openDocRejectModal();
      });
    });
  }


  /* ══════════════════════════════════════════════
     VIEW DOCUMENT (Signed URL)
     ══════════════════════════════════════════════ */

  async function viewDocument(filePath, mimeType) {
    try {
      showToast('Loading document…', '');

      // Generate signed URL (60 seconds expiry)
      var { data, error } = await sb.storage
        .from('verification-documents')
        .createSignedUrl(filePath, 60);

      if (error) throw error;

      var signedUrl = data.signedUrl;
      var isImage = mimeType && mimeType.startsWith('image/');

      if (isImage) {
        // Show in preview modal
        var previewOverlay = document.getElementById('imagePreview');
        var previewImg = document.getElementById('previewImage');
        previewImg.src = signedUrl;
        previewOverlay.classList.add('visible');
      } else {
        // Open in new tab for PDFs and others
        window.open(signedUrl, '_blank');
      }

    } catch (e) {
      console.error('View document error:', e);
      showToast('Failed to load document. ' + (e.message || ''), 'error');
    }
  }


  /* ── Image preview modal close ── */
  document.getElementById('previewClose').addEventListener('click', function () {
    document.getElementById('imagePreview').classList.remove('visible');
    document.getElementById('previewImage').src = '';
  });

  document.getElementById('imagePreview').addEventListener('click', function (e) {
    if (e.target === this) {
      this.classList.remove('visible');
      document.getElementById('previewImage').src = '';
    }
  });


  /* ══════════════════════════════════════════════
     VERIFY DOCUMENT
     ══════════════════════════════════════════════ */

  async function verifyDocument(docId) {
    try {
      var { error } = await sb.from('verification_documents')
        .update({
          status: 'VERIFIED',
          reviewed_by: currentUser.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', docId);

      if (error) throw error;

      showToast('Document verified.', 'success');
      if (currentDetailApp) await loadDocuments(currentDetailApp.id);

    } catch (e) {
      console.error('Verify document error:', e);
      showToast('Failed to verify document. ' + (e.message || ''), 'error');
    }
  }


  /* ══════════════════════════════════════════════
     REJECT DOCUMENT
     ══════════════════════════════════════════════ */

  async function rejectDocument(docId, reason) {
    try {
      var { error } = await sb.from('verification_documents')
        .update({
          status: 'REJECTED',
          review_notes: reason,
          reviewed_by: currentUser.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', docId);

      if (error) throw error;

      showToast('Document rejected.', 'success');
      if (currentDetailApp) await loadDocuments(currentDetailApp.id);

    } catch (e) {
      console.error('Reject document error:', e);
      showToast('Failed to reject document. ' + (e.message || ''), 'error');
    }
  }


  /* ══════════════════════════════════════════════
     APPROVAL FLOW
     ══════════════════════════════════════════════ */

  function setupModals() {
    // Approve modal
    document.getElementById('approveCancelBtn').addEventListener('click', closeApproveModal);
    document.getElementById('approveConfirmBtn').addEventListener('click', confirmApproval);
    document.getElementById('approveModal').addEventListener('click', function (e) {
      if (e.target === this) closeApproveModal();
    });

    // Reject modal
    document.getElementById('rejectCancelBtn').addEventListener('click', closeRejectModal);
    document.getElementById('rejectConfirmBtn').addEventListener('click', confirmRejection);
    document.getElementById('rejectModal').addEventListener('click', function (e) {
      if (e.target === this) closeRejectModal();
    });

    // Doc reject modal
    document.getElementById('docRejectCancelBtn').addEventListener('click', closeDocRejectModal);
    document.getElementById('docRejectConfirmBtn').addEventListener('click', confirmDocRejection);
    document.getElementById('docRejectModal').addEventListener('click', function (e) {
      if (e.target === this) closeDocRejectModal();
    });

    // Clear reject reason error on input
    document.getElementById('rejectReason').addEventListener('input', function () {
      document.getElementById('rejectReason-error').classList.remove('visible');
    });
    document.getElementById('docRejectReason').addEventListener('input', function () {
      document.getElementById('docRejectReason-error').classList.remove('visible');
    });

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeApproveModal();
        closeRejectModal();
        closeDocRejectModal();
        document.getElementById('imagePreview').classList.remove('visible');
      }
    });
  }


  function openApproveModal() {
    document.getElementById('approveModal').classList.add('visible');
  }

  function closeApproveModal() {
    document.getElementById('approveModal').classList.remove('visible');
  }

  function openRejectModal() {
    document.getElementById('rejectReason').value = '';
    document.getElementById('rejectReason-error').classList.remove('visible');
    document.getElementById('rejectModal').classList.add('visible');
  }

  function closeRejectModal() {
    document.getElementById('rejectModal').classList.remove('visible');
  }

  function openDocRejectModal() {
    document.getElementById('docRejectReason').value = '';
    document.getElementById('docRejectReason-error').classList.remove('visible');
    document.getElementById('docRejectModal').classList.add('visible');
  }

  function closeDocRejectModal() {
    document.getElementById('docRejectModal').classList.remove('visible');
    pendingDocRejectId = null;
  }


  async function confirmApproval() {
    if (!currentDetailApp) return;

    var btn = document.getElementById('approveConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sa-spinner"></span> Approving…';

    try {
      var { error } = await sb.from('lco_applications')
        .update({
          status: 'APPROVED',
          reviewed_by: currentUser.id,
          reviewed_at: new Date().toISOString(),
          review_notes: 'Approved by Super Admin'
        })
        .eq('id', currentDetailApp.id);

      if (error) throw error;

      showToast('Application approved successfully!', 'success');
      closeApproveModal();

      // Refresh data
      await loadApplications();
      await loadStats();

      // Re-open detail with updated data
      openDetail(currentDetailApp.id);

    } catch (e) {
      console.error('Approval error:', e);
      showToast('Failed to approve application. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✓ Confirm Approval';
    }
  }


  async function confirmRejection() {
    var reason = document.getElementById('rejectReason').value.trim();

    if (!reason) {
      document.getElementById('rejectReason-error').classList.add('visible');
      return;
    }

    if (!currentDetailApp) return;

    var btn = document.getElementById('rejectConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sa-spinner"></span> Rejecting…';

    try {
      var { error } = await sb.from('lco_applications')
        .update({
          status: 'REJECTED',
          reviewed_by: currentUser.id,
          reviewed_at: new Date().toISOString(),
          review_notes: reason
        })
        .eq('id', currentDetailApp.id);

      if (error) throw error;

      showToast('Application rejected.', 'success');
      closeRejectModal();

      // Refresh data
      await loadApplications();
      await loadStats();

      // Re-open detail
      openDetail(currentDetailApp.id);

    } catch (e) {
      console.error('Rejection error:', e);
      showToast('Failed to reject application. ' + (e.message || ''), 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✕ Reject Application';
    }
  }


  async function confirmDocRejection() {
    var reason = document.getElementById('docRejectReason').value.trim();

    if (!reason) {
      document.getElementById('docRejectReason-error').classList.add('visible');
      return;
    }

    if (!pendingDocRejectId) return;

    var btn = document.getElementById('docRejectConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sa-spinner"></span> Rejecting…';

    try {
      await rejectDocument(pendingDocRejectId, reason);
      closeDocRejectModal();
    } catch (e) {
      showToast('Failed to reject document.', 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✕ Reject Document';
    }
  }


  /* ══════════════════════════════════════════════
     TOAST
     ══════════════════════════════════════════════ */

  function showToast(message, type) {
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'sa-toast ' + (type || '');
    var icon = type === 'error' ? '⚠️' : type === 'success' ? '✓' : '💬';
    toast.innerHTML = '<span class="sa-toast-icon">' + icon + '</span>' + esc(message);
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

  function renderBadge(status) {
    var cls = 'pending';
    var label = status;
    if (status === 'APPROVED') cls = 'approved';
    else if (status === 'REJECTED') cls = 'rejected';
    else if (status === 'VERIFIED') cls = 'verified';
    else if (status === 'UNDER_REVIEW') { cls = 'pending'; label = 'UNDER REVIEW'; }
    return '<span class="sa-badge ' + cls + '">' + label + '</span>';
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

  function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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
