/* ============================================
   LCO CONNECT — Super Admin Dashboard Logic
   Phase 2 + Phase 3: Super Admin Dashboard
   with Verification & Onboarding
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
  var currentView = 'overview';
  var allApplications = [];
  var currentDetailApp = null;
  var currentDetailDocs = [];
  var currentFilter = 'all';
  var currentSearch = '';
  var pendingDocRejectId = null;

  // Phase 13A: LCO Directory & Governance State
  var lcoDirData = [];
  var lcoDirTotal = 0;
  var lcoDirOffset = 0;
  var lcoDirLimit = 15;
  var lcoDirSearch = '';
  var lcoDirStatusFilter = 'ALL';
  var lcoDirSearchTimer = null;
  var currentInspectAppId = null;
  var currentInspectDetail = null;
  var pendingGovernanceAction = null; // { applicationId, bizName, currentStatus, newStatus }


  /* ══════════════════════════════════════════════
     AUTH GUARD (uses shared LCOAuth module)
     ══════════════════════════════════════════════ */

  async function initAuth() {
    if (!sb) {
      showToast('Connection unavailable. Please refresh.', 'error');
      return;
    }

    try {
      // Use centralized role guard — requires SUPER_ADMIN
      var authData = await LCOAuth.requireRole('SUPER_ADMIN');

      // requireRole redirects if unauthorized; null means redirect is happening
      if (!authData) return;

      currentUser = {
        id: authData.session.user.id,
        email: authData.profile.email || authData.session.user.email,
        role: authData.profile.role
      };

      // Show dashboard
      document.getElementById('loadingScreen').style.display = 'none';
      document.getElementById('dashboardContainer').style.display = 'block';
      document.getElementById('adminEmail').textContent = currentUser.email;

      // Initialize dashboard
      initDashboard();

    } catch (e) {
      console.error('Auth check failed:', e);
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
    setupModals();
    setupSearch();
    setupFilters();
    setupStatCardClicks();
    setupLcoDirectory();
    setupInspectorModal();
    setupGovernanceModal();

    // Load data
    loadPlatformOverview();
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
      loadPlatformOverview();
      loadStats();
      loadRecentApplications();
    } else if (viewName === 'lco-directory') {
      lcoDirOffset = 0;
      loadLcoDirectory();
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
      await LCOAuth.signOut();
      LCOAuth.redirectToLogin();
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
      row += '<td data-label="Reason"><span style="font-size:13px;color:var(--slate);">' + esc(app.rejection_reason || app.review_notes || '—') + '</span></td>';
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

    // Registration info
    var regGrid = document.getElementById('detailRegistrationGrid');
    if (regGrid) {
      regGrid.innerHTML =
        detailField('Application ID', app.application_id) +
        detailField('Submitted', formatDateFull(app.created_at)) +
        detailField('Status', app.status) +
        detailField('Login Email', app.email);
    }

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
      var auditHtml = '<div class="sa-audit-row"><strong>Reviewed at</strong> ' + formatDateFull(app.reviewed_at) + '</div>';
      auditHtml += '<div class="sa-audit-row"><strong>Decision</strong> ' + esc(app.status) + '</div>';
      if (app.rejection_reason) {
        auditHtml += '<div class="sa-audit-row"><strong>Rejection Reason</strong> ' + esc(app.rejection_reason) + '</div>';
      }
      if (app.review_notes) {
        auditHtml += '<div class="sa-audit-row"><strong>Notes</strong> ' + esc(app.review_notes) + '</div>';
      }
      if (app.notification_status) {
        var notifLabel = app.notification_status === 'SENT' ? '✓ Sent' :
          app.notification_status === 'FAILED' ? '✕ Failed' : 'Not sent';
        auditHtml += '<div class="sa-audit-row"><strong>Email Notification</strong> ' + notifLabel + '</div>';
      }
      auditDiv.innerHTML = auditHtml;
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
        closeLcoInspector();
        closeGovernanceModal();
        document.getElementById('imagePreview').classList.remove('visible');
      }
    });
  }


  function openApproveModal() {
    // Pre-check: is the app already approved?
    if (currentDetailApp && currentDetailApp.status === 'APPROVED') {
      showToast('This application is already approved.', 'error');
      return;
    }
    document.getElementById('approveModal').classList.add('visible');
  }

  function closeApproveModal() {
    document.getElementById('approveModal').classList.remove('visible');
  }

  function openRejectModal() {
    // Pre-check: is the app already rejected?
    if (currentDetailApp && currentDetailApp.status === 'REJECTED') {
      showToast('This application is already rejected.', 'error');
      return;
    }
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


  /* ══════════════════════════════════════════════
     CONFIRM APPROVAL (Phase 3 enhanced)
     ══════════════════════════════════════════════
     1. Update application status → APPROVED
     2. Update LCO profile status → ACTIVE
     3. Create audit trail entry
     4. Attempt notification email
     ══════════════════════════════════════════════ */

  async function confirmApproval() {
    if (!currentDetailApp) return;

    // Double check status
    if (currentDetailApp.status === 'APPROVED') {
      showToast('This application is already approved.', 'error');
      closeApproveModal();
      return;
    }

    var btn = document.getElementById('approveConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sa-spinner"></span> Approving…';

    try {
      // One protected RPC updates the application, linked profile, and audit
      // record in a single database transaction.
      var { error: reviewError } = await sb.rpc('review_lco_application', {
        p_application_id: currentDetailApp.id,
        p_decision: 'APPROVED',
        p_review_notes: 'Approved by Super Admin',
        p_rejection_reason: null
      });
      if (reviewError) throw reviewError;

      // Email is deliberately separate: a delivery failure never undoes a
      // completed approval. The Edge Function records its own delivery state.
      var emailResult = await sendNotificationEmail(currentDetailApp.id, 'APPROVED');

      showToast('Application approved successfully!' + (emailResult.success ? ' Notification sent.' : ' (Email notification pending configuration)'), 'success');
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


  /* ══════════════════════════════════════════════
     CONFIRM REJECTION (Phase 3 enhanced)
     ══════════════════════════════════════════════
     1. Require rejection reason
     2. Update application status → REJECTED
     3. Update linked LCO profile status → REJECTED
     4. Create audit trail entry
     5. Attempt notification email
     ══════════════════════════════════════════════ */

  async function confirmRejection() {
    var reason = document.getElementById('rejectReason').value.trim();

    if (!reason) {
      document.getElementById('rejectReason-error').classList.add('visible');
      return;
    }

    if (!currentDetailApp) return;

    // Double check status
    if (currentDetailApp.status === 'REJECTED') {
      showToast('This application is already rejected.', 'error');
      closeRejectModal();
      return;
    }

    var btn = document.getElementById('rejectConfirmBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="sa-spinner"></span> Rejecting…';

    try {
      var { error: reviewError } = await sb.rpc('review_lco_application', {
        p_application_id: currentDetailApp.id,
        p_decision: 'REJECTED',
        p_review_notes: reason,
        p_rejection_reason: reason
      });
      if (reviewError) throw reviewError;

      var emailResult = await sendNotificationEmail(currentDetailApp.id, 'REJECTED');

      showToast('Application rejected.' + (emailResult.success ? ' Notification sent.' : ' (Email notification pending configuration)'), 'success');
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
     EMAIL NOTIFICATION (Phase 3.9 / 3.10)
     ══════════════════════════════════════════════
     Structure for sending approval/rejection emails.
     Uses Supabase Edge Function if available.
     Falls back gracefully if not configured.
     ══════════════════════════════════════════════ */

  async function sendNotificationEmail(applicationId, decision) {
    try {
      // Attempt to call Supabase Edge Function
      // This is the secure server-side approach.
      // The Edge Function must be deployed separately.
      var { data, error } = await sb.functions.invoke('send-lco-notification', {
        body: {
          application_id: applicationId,
          decision: decision
        }
      });

      if (error) {
        console.warn('Email notification edge function error:', error);
        return { success: false, error: error.message };
      }

      return { success: !!(data && data.ok) };

    } catch (e) {
      // Edge function not deployed or not available
      console.warn('Email notification not available (Edge Function not deployed):', e.message);
      return { success: false, error: 'Email service not configured' };
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
     PHASE 13A: PLATFORM OVERVIEW RPC
     ══════════════════════════════════════════════ */

  async function loadPlatformOverview() {
    try {
      var { data, error } = await sb.rpc('get_super_admin_platform_overview');
      if (error) throw error;
      if (!data) return;

      var o = Array.isArray(data) ? data[0] : data;
      if (!o) return;

      // Row 1 – LCO Application & Account Metrics
      setStatValue('statTotalValue', o.total_lco_applications);
      setStatValue('statApprovedValue', o.total_approved_lcos);
      setStatValue('statActiveLcosValue', o.active_lcos);
      setStatValue('statSuspendedLcosValue', o.suspended_lcos);

      // Row 2 – Secondary
      setStatValue('statPendingValue', o.pending_lco_applications);
      setStatValue('statRejectedValue', o.rejected_lco_applications);
      setStatValue('statCustomersValue', o.total_customers);
      setStatSub('statCustomersSub', 'Active: ' + (o.active_customers || 0));
      setStatValue('statTechniciansValue', o.total_technicians);
      setStatSub('statTechniciansSub', 'Active: ' + (o.active_technicians || 0));

      // Row 3 – Service & Financial
      setStatValue('statRequestsValue', o.total_service_requests);
      setStatSub('statRequestsSub', 'Open: ' + (o.open_service_requests || 0));
      setStatValue('statBilledValue', formatCurrency(o.total_billed_amount));
      setStatValue('statCollectedValue', formatCurrency(o.total_collected_amount));

      // Nav badge
      document.getElementById('navPendingCount').textContent = o.pending_lco_applications || 0;

    } catch (e) {
      console.error('Platform overview error:', e);
      // Silently fall back to existing loadStats
    }
  }

  function setStatValue(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = (val !== null && val !== undefined) ? val : 0;
  }

  function setStatSub(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatCurrency(amount) {
    if (!amount && amount !== 0) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }


  /* ══════════════════════════════════════════════
     PHASE 13A: LCO DIRECTORY
     ══════════════════════════════════════════════ */

  function setupLcoDirectory() {
    // Search
    var searchInput = document.getElementById('lcoDirSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(lcoDirSearchTimer);
        lcoDirSearchTimer = setTimeout(function () {
          lcoDirSearch = searchInput.value.trim();
          lcoDirOffset = 0;
          loadLcoDirectory();
        }, 300);
      });
    }

    // Status filter
    var statusSelect = document.getElementById('lcoDirStatusSelect');
    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        lcoDirStatusFilter = statusSelect.value;
        lcoDirOffset = 0;
        loadLcoDirectory();
      });
    }

    // Pagination
    var prevBtn = document.getElementById('lcoDirPrevBtn');
    var nextBtn = document.getElementById('lcoDirNextBtn');
    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (lcoDirOffset >= lcoDirLimit) {
          lcoDirOffset -= lcoDirLimit;
          loadLcoDirectory();
        }
      });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (lcoDirOffset + lcoDirLimit < lcoDirTotal) {
          lcoDirOffset += lcoDirLimit;
          loadLcoDirectory();
        }
      });
    }
  }

  async function loadLcoDirectory() {
    var tbody = document.getElementById('lcoDirTableBody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--slate);">Loading directory…</td></tr>';

    try {
      var { data, error } = await sb.rpc('get_super_admin_lco_directory', {
        p_search: lcoDirSearch || null,
        p_status: lcoDirStatusFilter === 'ALL' ? null : lcoDirStatusFilter,
        p_limit: lcoDirLimit,
        p_offset: lcoDirOffset
      });

      if (error) throw error;

      var res = Array.isArray(data) ? data[0] : data;
      lcoDirData = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);

      if (res && res.pagination && res.pagination.total_records !== undefined) {
        lcoDirTotal = parseInt(res.pagination.total_records, 10);
      } else {
        lcoDirTotal = lcoDirData.length;
      }

      if (lcoDirData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8"><div class="sa-empty"><div class="sa-empty-icon">🏢</div><h3>No LCOs found</h3><p>' +
          (lcoDirSearch ? 'No results match your search criteria.' : 'No approved LCO operators yet.') +
          '</p></div></td></tr>';
        updateLcoDirPagination();
        return;
      }

      tbody.innerHTML = lcoDirData.map(function (lco) {
        var acctBadge = renderAccountBadge(lco.account_status || 'ACTIVE');
        var custCount = lco.total_customers !== undefined ? lco.total_customers : (lco.customer_count || 0);
        var techCount = lco.total_technicians !== undefined ? lco.total_technicians : (lco.technician_count || 0);
        var targetId = lco.id || lco.application_id;

        return '<tr data-app-id="' + esc(targetId) + '" class="sa-lco-dir-row">' +
          '<td data-label="App ID"><span class="sa-app-id">' + esc(lco.application_id) + '</span></td>' +
          '<td data-label="Business & Owner"><span class="sa-biz-name">' + esc(lco.business_name) + '</span><div style="font-size:12px;color:var(--slate);margin-top:2px;">' + esc(lco.owner_name) + '</div></td>' +
          '<td data-label="Contact"><div style="font-size:13px;">' + esc(lco.phone || '—') + '</div><div style="font-size:12px;color:var(--slate);margin-top:1px;">' + esc(lco.email || '—') + '</div></td>' +
          '<td data-label="Location">' + esc(lco.city || '') + (lco.state ? ', ' + esc(lco.state) : '') + '</td>' +
          '<td data-label="Account Status">' + acctBadge + '</td>' +
          '<td data-label="Customers" style="text-align:center; font-weight:600;">' + custCount + '</td>' +
          '<td data-label="Technicians" style="text-align:center; font-weight:600;">' + techCount + '</td>' +
          '<td data-label="Actions"><button class="sa-view-btn sa-inspect-btn" data-app-id="' + esc(targetId) + '">Inspect</button></td>' +
          '</tr>';
      }).join('');

      // Attach click handlers
      tbody.querySelectorAll('.sa-inspect-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          openLcoInspector(btn.dataset.appId);
        });
      });
      tbody.querySelectorAll('.sa-lco-dir-row').forEach(function (row) {
        row.addEventListener('click', function () {
          openLcoInspector(row.dataset.appId);
        });
      });

      updateLcoDirPagination();

    } catch (e) {
      console.error('LCO directory error:', e);
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#E74C3C;">Failed to load directory. ' + esc(e.message || '') + '</td></tr>';
    }
  }

  function updateLcoDirPagination() {
    var infoEl = document.getElementById('lcoDirPaginationInfo');
    var prevBtn = document.getElementById('lcoDirPrevBtn');
    var nextBtn = document.getElementById('lcoDirNextBtn');

    var start = lcoDirTotal > 0 ? lcoDirOffset + 1 : 0;
    var end = Math.min(lcoDirOffset + lcoDirLimit, lcoDirTotal);
    if (infoEl) infoEl.textContent = 'Showing ' + start + '–' + end + ' of ' + lcoDirTotal;

    if (prevBtn) prevBtn.disabled = (lcoDirOffset <= 0);
    if (nextBtn) nextBtn.disabled = (lcoDirOffset + lcoDirLimit >= lcoDirTotal);
  }

  function renderAccountBadge(status) {
    if (status === 'SUSPENDED') {
      return '<span class="sa-badge suspended">SUSPENDED</span>';
    }
    return '<span class="sa-badge approved">ACTIVE</span>';
  }


  /* ══════════════════════════════════════════════
     PHASE 13A: LCO DETAIL INSPECTOR
     ══════════════════════════════════════════════ */

  function setupInspectorModal() {
    var closeTopBtn = document.getElementById('lcoInspectCloseTopBtn');
    var closeBtn = document.getElementById('lcoInspectCloseBtn');
    var overlay = document.getElementById('lcoDetailModal');

    if (closeTopBtn) closeTopBtn.addEventListener('click', closeLcoInspector);
    if (closeBtn) closeBtn.addEventListener('click', closeLcoInspector);
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeLcoInspector();
      });
    }
  }

  function closeLcoInspector() {
    var modal = document.getElementById('lcoDetailModal');
    if (modal) modal.classList.remove('visible');
    currentInspectAppId = null;
    currentInspectDetail = null;
  }

  async function openLcoInspector(applicationId) {
    currentInspectAppId = applicationId;
    var modal = document.getElementById('lcoDetailModal');
    modal.classList.add('visible');

    // Reset content
    document.getElementById('lcoInspectBizName').textContent = 'Loading…';
    document.getElementById('lcoInspectAppId').textContent = applicationId;
    document.getElementById('lcoInspectAccountBadge').innerHTML = '';
    document.getElementById('lcoInspectContent').innerHTML =
      '<div style="text-align:center; padding:40px; color:var(--slate);">Loading LCO detail inspection…</div>';
    document.getElementById('lcoInspectActionWrap').innerHTML = '';

    try {
      var { data, error } = await sb.rpc('get_super_admin_lco_detail', {
        p_application_id: applicationId
      });

      if (error) throw error;
      if (!data) {
        document.getElementById('lcoInspectContent').innerHTML =
          '<div style="text-align:center; padding:40px; color:#E74C3C;">LCO detail not found for this application.</div>';
        return;
      }

      var raw = Array.isArray(data) ? data[0] : data;
      if (!raw) {
        document.getElementById('lcoInspectContent').innerHTML =
          '<div style="text-align:center; padding:40px; color:#E74C3C;">LCO detail not found for this application.</div>';
        return;
      }

      var app = raw.application || raw;
      var cust = raw.customers || {};
      var tech = raw.technicians || {};
      var bill = raw.billing || {};
      var pay = raw.payments || {};
      var req = raw.service_requests || {};
      currentInspectDetail = app;

      // Header
      document.getElementById('lcoInspectBizName').textContent = app.business_name || '—';
      document.getElementById('lcoInspectAppId').textContent = app.application_id || applicationId;
      document.getElementById('lcoInspectAccountBadge').innerHTML = renderAccountBadge(app.account_status || 'ACTIVE');

      // Build content sections
      var html = '';

      // Business Information
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">🏢</span> Business Information</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Business Name', app.business_name);
      html += inspectField('Owner', app.owner_name);
      html += inspectField('Email', app.email);
      html += inspectField('Phone', app.phone);
      html += inspectField('Address', app.address);
      html += inspectField('City', app.city);
      html += inspectField('State', app.state);
      html += inspectField('PIN Code', app.pincode);
      html += '</div></div>';

      // Account & Application Status
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">📋</span> Status & Application</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Application Status', app.application_status || 'APPROVED');
      html += inspectField('Account Status', app.account_status || 'ACTIVE');
      html += inspectField('Application Date', formatDate(app.created_at));
      html += inspectField('Approval Date', formatDate(app.reviewed_at));
      html += '</div></div>';

      // Customer Metrics
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">👥</span> Customer Metrics</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Total Customers', cust.total !== undefined ? cust.total : 0);
      html += inspectField('Active Customers', cust.active !== undefined ? cust.active : 0);
      html += '</div></div>';

      // Technician Metrics
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">🔧</span> Technician Metrics</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Total Technicians', tech.total !== undefined ? tech.total : 0);
      html += inspectField('Active Technicians', tech.active !== undefined ? tech.active : 0);
      html += '</div></div>';

      // Billing & Payment Metrics
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">💰</span> Billing & Payment Metrics</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Total Billed', formatCurrency(bill.total_billed_amount));
      html += inspectField('Total Collected', formatCurrency(pay.total_collected_amount));
      html += inspectField('Outstanding', formatCurrency(bill.outstanding_balance));
      html += '</div></div>';

      // Service Request Metrics
      html += '<div class="sa-inspect-section">';
      html += '<div class="sa-inspect-section-title"><span class="sa-detail-section-icon">📡</span> Service Request Metrics</div>';
      html += '<div class="sa-inspect-grid">';
      html += inspectField('Total Requests', req.total_requests !== undefined ? req.total_requests : 0);
      html += inspectField('Open Requests', req.open_requests !== undefined ? req.open_requests : 0);
      html += inspectField('Resolved Requests', req.resolved_requests !== undefined ? req.resolved_requests : 0);
      html += '</div></div>';

      document.getElementById('lcoInspectContent').innerHTML = html;

      // Action buttons (governance)
      renderInspectorActions(app);

    } catch (e) {
      console.error('LCO detail error:', e);
      document.getElementById('lcoInspectContent').innerHTML =
        '<div style="text-align:center; padding:40px; color:#E74C3C;">Failed to load LCO details. ' + esc(e.message || '') + '</div>';
    }
  }

  function inspectField(label, value) {
    return '<div class="sa-inspect-field">' +
      '<div class="sa-detail-label">' + esc(label) + '</div>' +
      '<div class="sa-detail-value">' + esc(String(value !== null && value !== undefined ? value : '—')) + '</div>' +
      '</div>';
  }

  function renderInspectorActions(detail) {
    var wrap = document.getElementById('lcoInspectActionWrap');
    if (!wrap) return;

    var acctStatus = detail.account_status || 'ACTIVE';

    if (acctStatus === 'ACTIVE') {
      wrap.innerHTML = '<button class="sa-btn-suspend" id="lcoInspectSuspendBtn">🚫 Suspend Account</button>';
      document.getElementById('lcoInspectSuspendBtn').addEventListener('click', function () {
        openGovernanceModal(detail.application_id, detail.business_name, 'ACTIVE', 'SUSPENDED');
      });
    } else if (acctStatus === 'SUSPENDED') {
      wrap.innerHTML = '<button class="sa-btn-reactivate" id="lcoInspectReactivateBtn">✅ Reactivate Account</button>';
      document.getElementById('lcoInspectReactivateBtn').addEventListener('click', function () {
        openGovernanceModal(detail.application_id, detail.business_name, 'SUSPENDED', 'ACTIVE');
      });
    } else {
      wrap.innerHTML = '';
    }
  }


  /* ══════════════════════════════════════════════
     PHASE 13A: ACCOUNT GOVERNANCE
     ══════════════════════════════════════════════ */

  function setupGovernanceModal() {
    var cancelBtn = document.getElementById('manageLcoCancelBtn');
    var confirmBtn = document.getElementById('manageLcoConfirmBtn');
    var overlay = document.getElementById('manageLcoStatusModal');
    var reasonInput = document.getElementById('manageLcoReasonInput');

    if (cancelBtn) cancelBtn.addEventListener('click', closeGovernanceModal);
    if (overlay) {
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) closeGovernanceModal();
      });
    }
    if (confirmBtn) confirmBtn.addEventListener('click', confirmGovernanceAction);
    if (reasonInput) {
      reasonInput.addEventListener('input', function () {
        document.getElementById('manageLcoReasonError').classList.remove('visible');
      });
    }
  }

  function openGovernanceModal(applicationId, bizName, currentStatus, newStatus) {
    pendingGovernanceAction = {
      applicationId: applicationId,
      bizName: bizName,
      currentStatus: currentStatus,
      newStatus: newStatus
    };

    var titleEl = document.getElementById('manageLcoStatusModalTitle');
    var alertEl = document.getElementById('manageLcoStatusAlert');
    var infoEl = document.getElementById('manageLcoTargetInfo');
    var confirmBtn = document.getElementById('manageLcoConfirmBtn');
    var reasonInput = document.getElementById('manageLcoReasonInput');
    var reasonError = document.getElementById('manageLcoReasonError');

    // Reset
    if (reasonInput) reasonInput.value = '';
    if (reasonError) reasonError.classList.remove('visible');

    if (newStatus === 'SUSPENDED') {
      titleEl.textContent = '🚫 Suspend LCO Account';
      alertEl.style.background = '#FDEDEC';
      alertEl.style.color = '#C0392B';
      alertEl.style.border = '1px solid #FADBD8';
      alertEl.innerHTML = '<strong>Warning:</strong> Suspending this account will prevent the LCO from accessing their dashboard, managing customers, and processing service requests. This action can be reversed by reactivating the account.';
      confirmBtn.textContent = '🚫 Confirm Suspension';
      confirmBtn.style.background = '#E74C3C';
      confirmBtn.style.boxShadow = '0 2px 8px rgba(231,76,60,0.2)';
    } else {
      titleEl.textContent = '✅ Reactivate LCO Account';
      alertEl.style.background = 'var(--teal-light)';
      alertEl.style.color = 'var(--teal-dark)';
      alertEl.style.border = '1px solid rgba(11,122,110,0.15)';
      alertEl.innerHTML = '<strong>Notice:</strong> Reactivating this account will restore the LCO\'s access to their dashboard, customer management, and service request processing.';
      confirmBtn.textContent = '✅ Confirm Reactivation';
      confirmBtn.style.background = 'linear-gradient(155deg, var(--teal), var(--teal-dark))';
      confirmBtn.style.boxShadow = '0 2px 8px rgba(11,122,110,0.2)';
    }

    infoEl.innerHTML = 'LCO: <span style="color:var(--teal-dark);">' + esc(bizName) + '</span> (App ID: <span class="mono">' + esc(applicationId) + '</span>)';

    document.getElementById('manageLcoStatusModal').classList.add('visible');
  }

  function closeGovernanceModal() {
    document.getElementById('manageLcoStatusModal').classList.remove('visible');
    pendingGovernanceAction = null;
  }

  async function confirmGovernanceAction() {
    if (!pendingGovernanceAction) return;

    var reason = document.getElementById('manageLcoReasonInput').value.trim();
    if (!reason) {
      document.getElementById('manageLcoReasonError').classList.add('visible');
      return;
    }

    var btn = document.getElementById('manageLcoConfirmBtn');
    btn.disabled = true;
    var originalText = btn.textContent;
    btn.innerHTML = '<span class="sa-spinner"></span> Processing…';

    try {
      var { data, error } = await sb.rpc('manage_lco_status', {
        p_application_id: pendingGovernanceAction.applicationId,
        p_new_status: pendingGovernanceAction.newStatus,
        p_reason: reason
      });

      if (error) throw error;

      var action = pendingGovernanceAction.newStatus === 'SUSPENDED' ? 'suspended' : 'reactivated';
      showToast('Account successfully ' + action + ': ' + pendingGovernanceAction.bizName, 'success');

      closeGovernanceModal();

      // Refresh all affected views
      await loadPlatformOverview();
      await loadLcoDirectory();

      // If the inspector is still open for this LCO, refresh it
      if (currentInspectAppId === pendingGovernanceAction.applicationId) {
        await openLcoInspector(currentInspectAppId);
      }

    } catch (e) {
      console.error('Governance action error:', e);
      showToast('Failed to update status: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
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
