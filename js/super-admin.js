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

  // Phase 13B: User Directory State
  var userDirData = [];
  var userDirTotal = 0;
  var userDirOffset = 0;
  var userDirLimit = 15;
  var userDirSearch = '';
  var userDirRoleFilter = 'ALL';
  var userDirStatusFilter = 'ALL';
  var userDirSearchTimer = null;
  var userDirRequestId = 0;

  // Phase 13B: Communication Oversight State
  var commData = [];
  var commTotal = 0;
  var commOffset = 0;
  var commLimit = 15;
  var commSearch = '';
  var commCategoryFilter = 'ALL';
  var commRecipientRoleFilter = 'ALL';
  var commLcoFilter = 'ALL';
  var commSearchTimer = null;
  var commRequestId = 0;

  var platformLcosList = [];


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
    setupUserDirectory();
    setupUserInspectorModal();
    setupCommunicationOversight();
    setupAuditSecurity();

    // Load data
    loadPlatformOverview();
    loadStats();
    loadApplications();
    loadPlatformLcos();
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
    } else if (viewName === 'user-directory') {
      userDirOffset = 0;
      loadUserDirectory();
    } else if (viewName === 'communication-oversight') {
      commOffset = 0;
      loadCommunicationOversight();
    } else if (viewName === 'audit-security') {
      auditOffset = 0;
      loadAuditSecurity();
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
        closeUserInspectorModal();
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

  // Alias for Phase 13B code that uses escapeHtml instead of esc
  var escapeHtml = esc;

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
     PHASE 13B: LCO DROPDOWN DATA
     ══════════════════════════════════════════════ */

  async function loadPlatformLcos() {
    try {
      var { data, error } = await sb.rpc('get_super_admin_lco_directory', {
        p_search: null,
        p_status: 'ALL',
        p_limit: 500,
        p_offset: 0
      });
      if (error) throw error;
      var records = (data && data.data) ? data.data : [];
      platformLcosList = records.map(function (r) {
        return { id: r.lco_id || r.id, name: r.business_name || r.owner_name };
      });

      populateLcoDropdowns();
    } catch (e) {
      console.warn('Could not load LCO list for filters:', e);
    }
  }

  function populateLcoDropdowns() {
    var commSelect = document.getElementById('commLcoSelect');

    var optsHtml = '<option value="ALL">All LCOs</option>';
    platformLcosList.forEach(function (lco) {
      if (lco.id && lco.name) {
        optsHtml += '<option value="' + escapeHtml(lco.id) + '">' + escapeHtml(lco.name) + '</option>';
      }
    });

    if (commSelect) commSelect.innerHTML = optsHtml;
  }


  /* ══════════════════════════════════════════════
     PHASE 13B: USER DIRECTORY
     ══════════════════════════════════════════════ */

  function setupUserDirectory() {
    var searchInput = document.getElementById('userDirSearchInput');
    var roleSelect = document.getElementById('userDirRoleSelect');
    var statusSelect = document.getElementById('userDirStatusSelect');
    var prevBtn = document.getElementById('userDirPrevBtn');
    var nextBtn = document.getElementById('userDirNextBtn');
    var tbody = document.getElementById('userDirTableBody');

    // Delegated click handler on user directory table
    if (tbody) {
      tbody.addEventListener('click', function (e) {
        var btn = e.target.closest('.btn-inspect-user');
        if (btn && btn.dataset.userId) {
          e.stopPropagation();
          openUserInspector(btn.dataset.userId);
        }
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        if (userDirSearchTimer) clearTimeout(userDirSearchTimer);
        userDirSearchTimer = setTimeout(function () {
          userDirSearch = searchInput.value.trim();
          userDirOffset = 0;
          loadUserDirectory();
        }, 300);
      });
    }

    if (roleSelect) {
      roleSelect.addEventListener('change', function () {
        userDirRoleFilter = roleSelect.value;
        userDirOffset = 0;
        loadUserDirectory();
      });
    }

    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        userDirStatusFilter = statusSelect.value;
        userDirOffset = 0;
        loadUserDirectory();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (userDirOffset >= userDirLimit) {
          userDirOffset -= userDirLimit;
          loadUserDirectory();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (userDirOffset + userDirLimit < userDirTotal) {
          userDirOffset += userDirLimit;
          loadUserDirectory();
        }
      });
    }
  }

  async function loadUserDirectory() {
    console.log('[Phase13B] loadUserDirectory called');
    var tbody = document.getElementById('userDirTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:var(--slate);"><span class="sa-spinner"></span> Loading user directory…</td></tr>';
    }

    try {
      var roleParam = userDirRoleFilter === 'ALL' ? null : userDirRoleFilter;
      var statusParam = userDirStatusFilter === 'ALL' ? null : userDirStatusFilter;

      console.log('[UserDir Debug] Requesting RPC get_super_admin_user_directory with params:', {
        p_search: userDirSearch || null,
        p_role: roleParam,
        p_status: statusParam,
        p_lco_id: null,
        p_limit: userDirLimit,
        p_offset: userDirOffset
      });

      var { data, error } = await sb.rpc('get_super_admin_user_directory', {
        p_search: userDirSearch || null,
        p_role: roleParam,
        p_status: statusParam,
        p_lco_id: null,
        p_limit: userDirLimit,
        p_offset: userDirOffset
      });

      console.log('[UserDir Debug] sb.rpc returned raw data:', data, 'error:', error);

      if (error) {
        console.error('[UserDir Debug] RPC returned error object:', error);
        throw error;
      }

      // Unwrap result object or array returned by RPC
      var res = Array.isArray(data) ? data[0] : data;
      console.log('[UserDir Debug] Normalized res object:', res);

      var rawRecords = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
      console.log('[UserDir Debug] Extracted rawRecords count:', rawRecords.length, rawRecords);

      // Filter out SUPER_ADMIN role users from directory
      userDirData = rawRecords.filter(function (u) {
        return u && u.role !== 'SUPER_ADMIN';
      });
      console.log('[UserDir Debug] Filtered userDirData (excluding SUPER_ADMIN):', userDirData.length, userDirData);

      if (res && res.pagination && res.pagination.total_records !== undefined) {
        var totalFromPag = parseInt(res.pagination.total_records, 10);
        var superAdminCountInPage = rawRecords.length - userDirData.length;
        userDirTotal = Math.max(0, totalFromPag - superAdminCountInPage);
      } else {
        userDirTotal = userDirData.length;
      }
      console.log('[UserDir Debug] Calculated userDirTotal:', userDirTotal);

      renderUserDirectoryTable();
      updateUserDirPagination();
    } catch (e) {
      console.error('[UserDir Debug] Exception in loadUserDirectory:', e);
      if (tbody) {
        var errMsg = escapeHtml(e.message || e.error_description || (typeof e === 'string' ? e : 'Unknown error'));
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:32px; color:#E74C3C;"><div class="sa-empty"><div class="sa-empty-icon">⚠️</div><h3>Failed to load user directory</h3><p>' + errMsg + '</p></div></td></tr>';
      }
    }
  }

  function renderUserDirectoryTable() {
    var tbody = document.getElementById('userDirTableBody');
    if (!tbody) return;

    if (!userDirData || userDirData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="sa-empty"><div class="sa-empty-icon">👤</div><h3>No users found</h3><p>' +
        (userDirSearch ? 'No users match your search criteria.' : 'No registered platform users found.') +
        '</p></div></td></tr>';
      return;
    }

    var html = userDirData.map(function (u) {
      var roleClass = 'role-' + (u.role || '').toLowerCase().replace(/_/g, '-');
      var roleBadge = '<span class="sa-badge ' + roleClass + '">' + esc(u.role || '—') + '</span>';

      var statusStr = u.status || 'ACTIVE';
      var statusClass = statusStr.toUpperCase() === 'ACTIVE' ? 'approved' : statusStr.toUpperCase() === 'SUSPENDED' ? 'rejected' : 'pending';
      var statusBadge = '<span class="sa-badge ' + statusClass + '">' + esc(statusStr) + '</span>';

      var nameDisplay = esc(u.full_name || '—');
      var emailDisplay = esc(u.email || '—');
      var lcoDisplay = esc(u.lco_business_name || '—');
      var dateDisplay = u.created_at ? formatDate(u.created_at) : '—';

      return '<tr class="sa-lco-dir-row">' +
        '<td><strong style="color:var(--ink);">' + nameDisplay + '</strong></td>' +
        '<td><span class="mono" style="font-size:13px;">' + emailDisplay + '</span></td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td>' + lcoDisplay + '</td>' +
        '<td style="font-size:13px; color:var(--slate);">' + dateDisplay + '</td>' +
        '<td>' +
          '<button class="sa-view-btn btn-inspect-user" data-user-id="' + esc(u.user_id) + '" title="Inspect User Details">' +
            'View' +
          '</button>' +
        '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function updateUserDirPagination() {
    var info = document.getElementById('userDirPaginationInfo');
    var prevBtn = document.getElementById('userDirPrevBtn');
    var nextBtn = document.getElementById('userDirNextBtn');

    if (userDirTotal === 0) {
      if (info) info.textContent = 'Showing 0 of 0';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    var start = userDirOffset + 1;
    var end = Math.min(userDirOffset + userDirLimit, userDirTotal);
    if (info) info.textContent = 'Showing ' + start + '–' + end + ' of ' + userDirTotal;

    if (prevBtn) prevBtn.disabled = userDirOffset === 0;
    if (nextBtn) nextBtn.disabled = userDirOffset + userDirLimit >= userDirTotal;
  }


  /* ══════════════════════════════════════════════
     PHASE 13B: USER DETAIL INSPECTOR MODAL
     ══════════════════════════════════════════════ */

  function renderInspectField(label, value, isMono) {
    var valStr = (value !== null && value !== undefined && String(value).trim() !== '') ? String(value) : 'Not available';
    var valClass = 'sa-detail-value' + (isMono && valStr !== 'Not available' ? ' mono' : '');
    return '<div class="sa-inspect-field">' +
      '<div class="sa-detail-label">' + esc(label) + '</div>' +
      '<div class="' + valClass + '">' + esc(valStr) + '</div>' +
    '</div>';
  }

  function setupUserInspectorModal() {
    var closeTopBtn = document.getElementById('userInspectCloseTopBtn');
    var closeBtn = document.getElementById('userInspectCloseBtn');
    var modal = document.getElementById('userDetailModal');

    if (closeTopBtn) closeTopBtn.addEventListener('click', closeUserInspectorModal);
    if (closeBtn) closeBtn.addEventListener('click', closeUserInspectorModal);

    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeUserInspectorModal();
      });
    }
  }

  function closeUserInspectorModal() {
    var modal = document.getElementById('userDetailModal');
    if (modal) modal.classList.remove('visible');
  }

  async function openUserInspector(userId) {
    var modal = document.getElementById('userDetailModal');
    var titleEl = document.getElementById('userInspectTitle');
    var statusBadgeEl = document.getElementById('userInspectStatusBadge');
    var roleBadgeEl = document.getElementById('userInspectRoleBadge');
    var idLabelEl = document.getElementById('userInspectIdLabel');
    var userIdEl = document.getElementById('userInspectUserId');
    var contentEl = document.getElementById('userInspectContent');

    if (!modal || !contentEl) return;

    // Reset header & content immediately to prevent showing stale data from a previous user
    if (titleEl) titleEl.textContent = 'User Details';
    if (statusBadgeEl) statusBadgeEl.innerHTML = '';
    if (roleBadgeEl) roleBadgeEl.innerHTML = '';
    if (idLabelEl) idLabelEl.textContent = 'ID:';
    if (userIdEl) userIdEl.textContent = '—';
    contentEl.innerHTML = '<div style="text-align:center; padding:40px; color:var(--slate);"><span class="sa-spinner"></span> Loading user details…</div>';

    // Open modal using Super Admin standard .visible class
    modal.classList.add('visible');

    try {
      var { data, error } = await sb.rpc('get_super_admin_user_detail', {
        p_user_id: userId
      });

      if (error) throw error;

      var raw = Array.isArray(data) ? data[0] : data;
      if (!raw || !raw.profile) {
        contentEl.innerHTML = '<div class="sa-empty"><div class="sa-empty-icon">⚠️</div><h3>User profile not found</h3><p>No profile details found for the specified user ID.</p></div>';
        return;
      }

      var prof = raw.profile || {};
      var lco = raw.lco_association || {};
      var entity = raw.role_specific_entity || {};
      var comm = raw.communication_summary || {};

      var displayName = entity.full_name || entity.owner_name || prof.email || 'User Profile';
      if (titleEl) titleEl.textContent = displayName;

      var roleClass = 'role-' + (prof.role || '').toLowerCase().replace(/_/g, '-');
      if (roleBadgeEl) roleBadgeEl.innerHTML = '<span class="sa-badge ' + roleClass + '">' + esc(prof.role || '—') + '</span>';

      var statusStr = prof.status || 'ACTIVE';
      var statusClass = statusStr.toUpperCase() === 'ACTIVE' ? 'approved' : statusStr.toUpperCase() === 'SUSPENDED' ? 'rejected' : 'pending';
      if (statusBadgeEl) statusBadgeEl.innerHTML = '<span class="sa-badge ' + statusClass + '">' + esc(statusStr) + '</span>';

      // Role-aware Header ID Display (business identifier, never Supabase UUID)
      var businessId = null;
      var businessIdLabel = 'ID:';

      if (prof.role === 'LCO_ADMIN') {
        businessIdLabel = 'LCO ID:';
        businessId = entity.application_id || lco.application_id || null;
      } else if (prof.role === 'CUSTOMER') {
        businessIdLabel = 'Customer ID:';
        businessId = entity.customer_id || null;
      } else if (prof.role === 'TECHNICIAN') {
        businessIdLabel = 'Technician ID:';
        businessId = entity.technician_id || null;
      }

      if (idLabelEl) idLabelEl.textContent = businessIdLabel;
      if (userIdEl) userIdEl.textContent = businessId || 'Not available';

      var phoneVal = entity.phone || prof.phone || null;
      var emailVal = prof.email || entity.email || null;
      var html = '';

      // Section 1: ACCOUNT PROFILE
      html += '<div class="sa-inspect-section">' +
        '<div class="sa-inspect-section-title"><span>👤</span> Account Profile</div>' +
        '<div class="sa-inspect-grid">' +
          renderInspectField('Name', displayName) +
          renderInspectField('Email Address', emailVal) +
          renderInspectField('Account Status', prof.status || 'ACTIVE') +
          renderInspectField('Account Created', formatDateFull(prof.created_at)) +
          renderInspectField('Phone Number', phoneVal) +
        '</div>' +
      '</div>';

      // Section 2: ORGANIZATION
      if (lco && (lco.business_name || lco.lco_id || lco.application_id)) {
        var lcoLocation = (lco.city || '') + (lco.state ? ', ' + lco.state : '');
        html += '<div class="sa-inspect-section">' +
          '<div class="sa-inspect-section-title"><span>🏢</span> Organization</div>' +
          '<div class="sa-inspect-grid">' +
            renderInspectField('LCO Business Name', lco.business_name) +
            renderInspectField('LCO ID', lco.application_id || lco.lco_id, true) +
            renderInspectField('Application ID', lco.application_id, true) +
            renderInspectField('Location', lcoLocation || null) +
          '</div>' +
        '</div>';
      }

      // Section 3: ROLE-SPECIFIC DETAILS
      if (prof.role === 'LCO_ADMIN') {
        var fullAddr = [entity.address, entity.city, entity.state, entity.pincode].filter(Boolean).join(', ');
        html += '<div class="sa-inspect-section">' +
          '<div class="sa-inspect-section-title"><span>▤</span> LCO Admin Details</div>' +
          '<div class="sa-inspect-grid">' +
            renderInspectField('LCO ID', entity.application_id || lco.application_id, true) +
            renderInspectField('Owner Name', entity.owner_name) +
            renderInspectField('Contact Phone', entity.phone) +
            renderInspectField('Application Status', entity.application_status) +
            renderInspectField('Business Address', fullAddr || null) +
          '</div>' +
        '</div>';
      } else if (prof.role === 'CUSTOMER') {
        html += '<div class="sa-inspect-section">' +
          '<div class="sa-inspect-section-title"><span>👥</span> Customer Details</div>' +
          '<div class="sa-inspect-grid">' +
            renderInspectField('Customer ID', entity.customer_id, true) +
            renderInspectField('Full Name', entity.full_name) +
            renderInspectField('Service Status', entity.service_status) +
            renderInspectField('Service Type', entity.service_type) +
            renderInspectField('Plan Name', entity.plan_name) +
            renderInspectField('City', entity.city) +
            renderInspectField('Pincode', entity.pincode) +
            renderInspectField('Connection Date', entity.connection_date ? formatDate(entity.connection_date) : null) +
          '</div>' +
        '</div>';
      } else if (prof.role === 'TECHNICIAN') {
        html += '<div class="sa-inspect-section">' +
          '<div class="sa-inspect-section-title"><span>🛠️</span> Technician Details</div>' +
          '<div class="sa-inspect-grid">' +
            renderInspectField('Technician ID', entity.technician_id, true) +
            renderInspectField('Full Name', entity.full_name) +
            renderInspectField('Operational Status', entity.status) +
            renderInspectField('Invitation Status', entity.invitation_status) +
          '</div>' +
        '</div>';
      }

      // Section 4: COMMUNICATION ACTIVITY
      html += '<div class="sa-inspect-section">' +
        '<div class="sa-inspect-section-title"><span>📡</span> Communication Activity</div>' +
        '<div class="sa-inspect-grid">' +
          renderInspectField('Total Notifications', comm.total_notifications !== undefined && comm.total_notifications !== null ? comm.total_notifications : 0) +
          renderInspectField('Last Activity', comm.last_notification_at ? formatDateFull(comm.last_notification_at) : 'No communication recorded') +
        '</div>' +
      '</div>';

      contentEl.innerHTML = html;
    } catch (e) {
      console.error('Failed to load user detail:', e);
      contentEl.innerHTML = '<div style="text-align:center; padding:32px; color:#E74C3C;"><div class="sa-empty"><div class="sa-empty-icon">⚠️</div><h3>Failed to load user details</h3><p>' + esc(e.message || 'Unknown error') + '</p></div></div>';
    }
  }


  /* ══════════════════════════════════════════════
     PHASE 13B: COMMUNICATION OVERSIGHT
     ══════════════════════════════════════════════ */

  function setupCommunicationOversight() {
    var searchInput = document.getElementById('commSearchInput');
    var categorySelect = document.getElementById('commCategorySelect');
    var recipientRoleSelect = document.getElementById('commRecipientRoleSelect');
    var lcoSelect = document.getElementById('commLcoSelect');
    var prevBtn = document.getElementById('commPrevBtn');
    var nextBtn = document.getElementById('commNextBtn');

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        if (commSearchTimer) clearTimeout(commSearchTimer);
        commSearchTimer = setTimeout(function () {
          commSearch = searchInput.value.trim();
          commOffset = 0;
          loadCommunicationOversight();
        }, 300);
      });
    }

    if (categorySelect) {
      categorySelect.addEventListener('change', function () {
        commCategoryFilter = categorySelect.value;
        commOffset = 0;
        loadCommunicationOversight();
      });
    }

    if (recipientRoleSelect) {
      recipientRoleSelect.addEventListener('change', function () {
        commRecipientRoleFilter = recipientRoleSelect.value;
        commOffset = 0;
        loadCommunicationOversight();
      });
    }

    if (lcoSelect) {
      lcoSelect.addEventListener('change', function () {
        commLcoFilter = lcoSelect.value;
        commOffset = 0;
        loadCommunicationOversight();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (commOffset >= commLimit) {
          commOffset -= commLimit;
          loadCommunicationOversight();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (commOffset + commLimit < commTotal) {
          commOffset += commLimit;
          loadCommunicationOversight();
        }
      });
    }
  }

  async function loadCommunicationOversight() {
    console.log('[Phase13B] loadCommunicationOversight called');
    var tbody = document.getElementById('commTableBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--slate);"><span class="sa-spinner"></span> Loading communication oversight feed…</td></tr>';
    }

    var thisReqId = ++commRequestId;

    try {
      var lcoParam = commLcoFilter === 'ALL' ? null : commLcoFilter;
      var catParam = commCategoryFilter === 'ALL' ? null : commCategoryFilter;
      var roleParam = commRecipientRoleFilter === 'ALL' ? null : commRecipientRoleFilter;

      var { data, error } = await sb.rpc('get_super_admin_communication_oversight', {
        p_search: commSearch || null,
        p_lco_id: lcoParam,
        p_category: catParam,
        p_recipient_role: roleParam,
        p_limit: commLimit,
        p_offset: commOffset
      });

      if (thisReqId !== commRequestId) return; // Prevent stale request overwrite

      if (error) throw error;

      commData = (data && data.data) ? data.data : [];
      var pag = (data && data.pagination) ? data.pagination : {};
      commTotal = pag.total_records || 0;

      renderCommunicationTable();
      updateCommPagination();
    } catch (e) {
      if (thisReqId !== commRequestId) return;
      console.error('Communication oversight fetch error:', e);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:#E74C3C;">Failed to load communication oversight feed: ' + escapeHtml(e.message || 'Unknown error') + '</td></tr>';
      }
    }
  }

  function renderCommunicationTable() {
    var tbody = document.getElementById('commTableBody');
    if (!tbody) return;

    if (!commData || commData.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:32px; color:var(--slate);">No communication events found matching current filters.</td></tr>';
      return;
    }

    var html = commData.map(function (c) {
      var catClass = (c.category || '').toLowerCase();
      var catBadge = '<span class="sa-cat-badge ' + catClass + '">' + escapeHtml(c.category || 'SYSTEM') + '</span>';

      var roleClass = 'role-' + (c.recipient_role || '').toLowerCase().replace(/_/g, '-');
      var roleBadge = '<span class="sa-badge ' + roleClass + '">' + escapeHtml(c.recipient_role || '—') + '</span>';

      var statusText = escapeHtml(c.status_label || 'SENT');
      var statusBadgeClass = statusText.toLowerCase() === 'unread' || statusText.toLowerCase() === 'active' ? 'approved' : 'pending';
      var statusBadge = '<span class="sa-badge ' + statusBadgeClass + '">' + statusText + '</span>';

      var dateDisplay = c.created_at ? formatDate(c.created_at) : '—';
      var lcoDisplay = escapeHtml(c.lco_business_name || 'System');
      var titleDisplay = escapeHtml(c.title || '—');
      var recipientDisplay = escapeHtml(c.recipient_name || '—');
      var summaryDisplay = escapeHtml(c.summary || '—');

      return '<tr class="sa-lco-dir-row">' +
        '<td style="font-size:13px; color:var(--slate); white-space:nowrap;">' + dateDisplay + '</td>' +
        '<td><strong style="color:var(--ink); font-size:13px;">' + lcoDisplay + '</strong></td>' +
        '<td>' + catBadge + '</td>' +
        '<td><span style="font-weight:600; color:var(--ink);">' + titleDisplay + '</span></td>' +
        '<td>' + recipientDisplay + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td>' + statusBadge + '</td>' +
        '<td style="font-size:13px; color:var(--slate); max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + summaryDisplay + '">' + summaryDisplay + '</td>' +
      '</tr>';
    }).join('');

    tbody.innerHTML = html;
  }

  function updateCommPagination() {
    var info = document.getElementById('commPaginationInfo');
    var prevBtn = document.getElementById('commPrevBtn');
    var nextBtn = document.getElementById('commNextBtn');

    if (commTotal === 0) {
      if (info) info.textContent = 'Showing 0 of 0';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }

    var start = commOffset + 1;
    var end = Math.min(commOffset + commLimit, commTotal);
    if (info) info.textContent = 'Showing ' + start + '–' + end + ' of ' + commTotal;

    if (prevBtn) prevBtn.disabled = commOffset === 0;
    if (nextBtn) nextBtn.disabled = commOffset + commLimit >= commTotal;
  }


  /* ══════════════════════════════════════════════
     PHASE 13C-2: SYSTEM AUDIT & SECURITY OVERSIGHT
     ══════════════════════════════════════════════ */

  var auditSearchQuery = '';
  var auditCategoryFilter = 'ALL';
  var auditSeverityFilter = 'ALL';
  var auditRoleFilter = 'ALL';
  var auditDateFrom = null;
  var auditDateTo = null;
  var auditOffset = 0;
  var AUDIT_LIMIT = 50;

  function setupAuditSecurity() {
    var searchInput = document.getElementById('saAuditSearch');
    var catFilter = document.getElementById('saAuditCategoryFilter');
    var sevFilter = document.getElementById('saAuditSeverityFilter');
    var roleFilter = document.getElementById('saAuditRoleFilter');
    var dateFromInput = document.getElementById('saAuditDateFrom');
    var dateToInput = document.getElementById('saAuditDateTo');
    var resetBtn = document.getElementById('saAuditResetBtn');
    var prevBtn = document.getElementById('saAuditPrevBtn');
    var nextBtn = document.getElementById('saAuditNextBtn');

    var debounceTimer;
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          auditSearchQuery = searchInput.value;
          auditOffset = 0;
          loadAuditLogs();
        }, 350);
      });
    }

    if (catFilter) {
      catFilter.addEventListener('change', function () {
        auditCategoryFilter = catFilter.value;
        auditOffset = 0;
        loadAuditLogs();
      });
    }

    if (sevFilter) {
      sevFilter.addEventListener('change', function () {
        auditSeverityFilter = sevFilter.value;
        auditOffset = 0;
        loadAuditLogs();
      });
    }

    if (roleFilter) {
      roleFilter.addEventListener('change', function () {
        auditRoleFilter = roleFilter.value;
        auditOffset = 0;
        loadAuditLogs();
      });
    }

    if (dateFromInput) {
      dateFromInput.addEventListener('change', function () {
        auditDateFrom = dateFromInput.value || null;
        auditOffset = 0;
        loadAuditLogs();
      });
    }

    if (dateToInput) {
      dateToInput.addEventListener('change', function () {
        auditDateTo = dateToInput.value || null;
        auditOffset = 0;
        loadAuditLogs();
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        auditSearchQuery = '';
        auditCategoryFilter = 'ALL';
        auditSeverityFilter = 'ALL';
        auditRoleFilter = 'ALL';
        auditDateFrom = null;
        auditDateTo = null;
        auditOffset = 0;

        if (searchInput) searchInput.value = '';
        if (catFilter) catFilter.value = 'ALL';
        if (sevFilter) sevFilter.value = 'ALL';
        if (roleFilter) roleFilter.value = 'ALL';
        if (dateFromInput) dateFromInput.value = '';
        if (dateToInput) dateToInput.value = '';

        loadAuditLogs();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', function () {
        if (auditOffset >= AUDIT_LIMIT) {
          auditOffset -= AUDIT_LIMIT;
          loadAuditLogs();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        auditOffset += AUDIT_LIMIT;
        loadAuditLogs();
      });
    }

    // Modal Close handlers
    var modal = document.getElementById('saAuditModal');
    var closeTopBtn = document.getElementById('saAuditCloseTopBtn');
    var closeBtn = document.getElementById('saAuditCloseBtn');

    if (closeTopBtn) {
      closeTopBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        modal.classList.remove('visible');
      });
    }
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) modal.classList.remove('visible');
      });
    }
  }

  async function loadAuditSecurity() {
    await Promise.all([
      loadAuditMetrics(),
      loadAuditLogs()
    ]);
  }

  async function loadAuditMetrics() {
    try {
      var client = await getSupabaseClient();
      var { data, error } = await client.rpc('get_super_admin_security_metrics');
      if (error) throw error;

      var m = Array.isArray(data) ? data[0] : data;
      if (!m) return;

      var setVal = function (id, val) {
        var el = document.getElementById(id);
        if (el) el.textContent = (val || 0).toLocaleString();
      };

      setVal('statAuditTotalVal', m.total_audit_events);
      setVal('statAudit24hVal', m.events_last_24h);
      setVal('statAudit7dVal', m.events_last_7d);
      setVal('statAuditPrivilegedVal', m.recent_privileged_operations);
      setVal('statAuditGovernanceVal', m.governance_events);
      setVal('statAuditSecurityVal', m.security_events);
      setVal('statAuditWarningVal', m.warning_events);
      setVal('statAuditCriticalVal', m.critical_events);

    } catch (err) {
      console.error('Error loading security metrics:', err);
    }
  }

  async function loadAuditLogs() {
    var tbody = document.getElementById('saAuditTableBody');
    var pagDiv = document.getElementById('saAuditPagination');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="8" class="sa-table-empty">Loading audit logs...</td></tr>';

    try {
      var client = await getSupabaseClient();
      var { data, error } = await client.rpc('get_super_admin_audit_logs', {
        p_search: auditSearchQuery || null,
        p_category: auditCategoryFilter || 'ALL',
        p_severity: auditSeverityFilter || 'ALL',
        p_actor_role: auditRoleFilter || 'ALL',
        p_lco_id: null,
        p_date_from: auditDateFrom ? new Date(auditDateFrom).toISOString() : null,
        p_date_to: auditDateTo ? new Date(auditDateTo + 'T23:59:59').toISOString() : null,
        p_limit: AUDIT_LIMIT,
        p_offset: auditOffset
      });

      if (error) throw error;

      var raw = Array.isArray(data) ? data[0] : data;
      var list = (raw && raw.data) ? raw.data : [];
      var pagination = (raw && raw.pagination) ? raw.pagination : { total_records: 0, limit: AUDIT_LIMIT, offset: 0, has_more: false };

      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="sa-table-empty">No audit logs found matching criteria.</td></tr>';
        if (pagDiv) pagDiv.style.display = 'none';
        return;
      }

      var html = '';
      list.forEach(function (log) {
        var dateStr = formatDateFull(log.created_at);
        var categoryBadge = getCategoryBadgeHtml(log.category);
        var severityBadge = getSeverityBadgeHtml(log.severity);
        var actorDisplay = log.actor_email ? esc(log.actor_email) : 'System';
        var roleBadge = '<span class="sa-role-badge sa-role-' + esc((log.actor_role || 'SYSTEM').toLowerCase()) + '">' + esc(log.actor_role || 'SYSTEM') + '</span>';
        var entityDisplay = esc(log.entity_type) + ': <strong>' + esc(log.entity_id) + '</strong>';

        html += '<tr>';
        html += '<td style="white-space:nowrap;">' + dateStr + '</td>';
        html += '<td>' + categoryBadge + '</td>';
        html += '<td>' + severityBadge + '</td>';
        html += '<td><code style="font-family:\'IBM Plex Mono\',monospace; font-size:12px; background:var(--sand); padding:2px 6px; border-radius:4px;">' + esc(log.action) + '</code></td>';
        html += '<td><div>' + actorDisplay + '</div><div>' + roleBadge + '</div></td>';
        html += '<td>' + entityDisplay + '</td>';
        html += '<td style="max-width:280px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="' + esc(log.description) + '">' + esc(log.description) + '</td>';
        html += '<td style="text-align:right;"><button class="sa-view-btn sa-btn-inspect-audit" data-audit-id="' + esc(log.id) + '">View</button></td>';
        html += '</tr>';
      });

      tbody.innerHTML = html;

      // Event delegation / click listeners for inspect view buttons
      tbody.querySelectorAll('.sa-btn-inspect-audit').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var logId = btn.dataset.auditId;
          var logObj = list.find(function (item) { return item.id === logId; });
          if (logObj) openAuditInspector(logObj);
        });
      });

      // Pagination rendering
      if (pagDiv) {
        pagDiv.style.display = 'flex';
        var startNum = pagination.offset + 1;
        var endNum = Math.min(pagination.offset + pagination.limit, pagination.total_records);
        var info = document.getElementById('saAuditPaginationInfo');
        if (info) info.textContent = 'Showing ' + startNum + '–' + endNum + ' of ' + pagination.total_records + ' audit logs';
        var currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
        var totalPages = Math.ceil(pagination.total_records / pagination.limit) || 1;
        var pageEl = document.getElementById('saAuditPageNum');
        if (pageEl) pageEl.textContent = 'Page ' + currentPage + ' of ' + totalPages;
        var prevBtn = document.getElementById('saAuditPrevBtn');
        if (prevBtn) prevBtn.disabled = (pagination.offset === 0);
        var nextBtn = document.getElementById('saAuditNextBtn');
        if (nextBtn) nextBtn.disabled = !pagination.has_more;
      }

    } catch (err) {
      console.error('Error loading audit logs:', err);
      tbody.innerHTML = '<tr><td colspan="8" class="sa-table-empty sa-error">Error loading audit logs: ' + esc(err.message || String(err)) + '</td></tr>';
      if (pagDiv) pagDiv.style.display = 'none';
    }
  }

  function openAuditInspector(log) {
    var modal = document.getElementById('saAuditModal');
    var body = document.getElementById('saAuditModalBody');
    var modalId = document.getElementById('saAuditModalId');
    var modalBadge = document.getElementById('saAuditModalSevBadge');

    if (modalId) modalId.textContent = log.id;
    if (modalBadge) modalBadge.innerHTML = getSeverityBadgeHtml(log.severity);

    // Sanitize metadata payload to strictly exclude sensitive credentials/tokens if any exist
    var cleanMeta = sanitizeMetadata(log.metadata || {});
    var metaJson = '{}';
    try {
      metaJson = JSON.stringify(cleanMeta, null, 2);
    } catch (e) {
      metaJson = String(cleanMeta);
    }

    var html = '<div class="sa-inspect-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 20px;">';
    html += renderInspectField('Action', log.action, true);
    html += renderInspectField('Category', log.category);
    html += renderInspectField('Severity', log.severity);
    html += renderInspectField('Timestamp', formatDateFull(log.created_at));
    html += renderInspectField('Actor Email', log.actor_email || 'SYSTEM');
    html += renderInspectField('Actor Role', log.actor_role || 'SYSTEM');
    html += renderInspectField('Actor User ID', log.actor_id || 'System (N/A)', true);
    html += renderInspectField('Target Entity Type', log.entity_type);
    html += renderInspectField('Target Entity ID', log.entity_id, true);
    html += renderInspectField('Associated LCO', log.lco_business_name || (log.lco_id ? log.lco_id : 'None'));
    html += '</div>';

    html += '<div style="margin-bottom: 20px;">';
    html += '<label style="font-size:12px; font-weight:700; color:var(--slate); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Event Description</label>';
    html += '<div style="font-size:14px; color:var(--ink); background:var(--sand); padding:12px 16px; border-radius:8px; border:1px solid var(--line);">' + esc(log.description) + '</div>';
    html += '</div>';

    html += '<div>';
    html += '<label style="font-size:12px; font-weight:700; color:var(--slate); text-transform:uppercase; letter-spacing:0.05em; display:block; margin-bottom:6px;">Event Metadata Payload (JSON)</label>';
    html += '<pre class="sa-json-preview"><code>' + esc(metaJson) + '</code></pre>';
    html += '</div>';

    body.innerHTML = html;
    modal.classList.add('visible');
  }

  function sanitizeMetadata(meta) {
    if (!meta || typeof meta !== 'object') return {};
    var copy = JSON.parse(JSON.stringify(meta));
    var sensitiveKeys = ['password', 'token', 'secret', 'card', 'cvv', 'auth', 'jwt', 'api_key'];
    
    function recursiveClean(obj) {
      if (!obj || typeof obj !== 'object') return;
      Object.keys(obj).forEach(function (k) {
        var lower = k.toLowerCase();
        if (sensitiveKeys.some(function (sk) { return lower.includes(sk); })) {
          obj[k] = '[REDACTED]';
        } else if (typeof obj[k] === 'object') {
          recursiveClean(obj[k]);
        }
      });
    }
    recursiveClean(copy);
    return copy;
  }

  function getSeverityBadgeHtml(sev) {
    var s = (sev || 'INFO').toUpperCase();
    var cls = 'info';
    if (s === 'WARNING') cls = 'warning';
    if (s === 'CRITICAL') cls = 'critical';
    return '<span class="sa-sev-badge ' + cls + '">' + esc(s) + '</span>';
  }

  function getCategoryBadgeHtml(cat) {
    var c = (cat || 'SYSTEM').toUpperCase();
    var cls = c.toLowerCase();
    return '<span class="sa-audit-cat-badge ' + cls + '">' + esc(c) + '</span>';
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
