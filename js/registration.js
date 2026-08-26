/* ============================================
   LCO CONNECT — Registration Logic
   Phase 1: LCO Registration & Verification
   ============================================ */

(function () {
  'use strict';

  /* ══════════════════════════════════════════════
     SUPABASE INITIALIZATION
     ══════════════════════════════════════════════ */

  // Supabase credentials from environment / config
  // These are the PUBLIC anon key — safe for frontend use
  var SUPABASE_URL = 'https://qlidbycuvuurnalbvfcc.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_LpSmIK-o-DO1_-fKIQ7yWg_VYbVddGC';

  var supabase = null;

  try {
    if (window.supabase && window.supabase.createClient) {
      supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
  } catch (e) {
    console.error('Supabase initialization failed:', e);
  }


  /* ══════════════════════════════════════════════
     INDIAN STATES & UNION TERRITORIES
     ══════════════════════════════════════════════ */

  var INDIAN_STATES = [
    // States (28)
    'Andhra Pradesh',
    'Arunachal Pradesh',
    'Assam',
    'Bihar',
    'Chhattisgarh',
    'Goa',
    'Gujarat',
    'Haryana',
    'Himachal Pradesh',
    'Jharkhand',
    'Karnataka',
    'Kerala',
    'Madhya Pradesh',
    'Maharashtra',
    'Manipur',
    'Meghalaya',
    'Mizoram',
    'Nagaland',
    'Odisha',
    'Punjab',
    'Rajasthan',
    'Sikkim',
    'Tamil Nadu',
    'Telangana',
    'Tripura',
    'Uttar Pradesh',
    'Uttarakhand',
    'West Bengal',
    // Union Territories (8)
    'Andaman and Nicobar Islands',
    'Chandigarh',
    'Dadra and Nagar Haveli and Daman and Diu',
    'Delhi',
    'Jammu and Kashmir',
    'Ladakh',
    'Lakshadweep',
    'Puducherry'
  ];

  // Already alphabetically sorted above


  /* ══════════════════════════════════════════════
     STATE MANAGEMENT
     ══════════════════════════════════════════════ */

  var currentStep = 1;
  var totalSteps = 5;

  // Store uploaded files in memory
  var uploadedFiles = {
    business_proof: [],
    identity_proof: [],
    registration_certificate: [],
    other_document: []
  };


  /* ══════════════════════════════════════════════
     DOM REFERENCES
     ══════════════════════════════════════════════ */

  var form = document.getElementById('registrationForm');
  var progressSteps = document.querySelectorAll('.progress-step');
  var progressArrows = document.querySelectorAll('.progress-arrow');
  var formSteps = document.querySelectorAll('.form-step');


  /* ══════════════════════════════════════════════
     INITIALIZATION
     ══════════════════════════════════════════════ */

  function init() {
    populateStateDropdowns();
    setupNavigationButtons();
    setupServiceCheckboxes();
    setupFileUploads();
    setupEditButtons();
    setupFormSubmit();
    setupInputListeners();
  }


  /* ── Populate state dropdowns ── */
  function populateStateDropdowns() {
    var selects = [
      document.getElementById('businessState'),
      document.getElementById('serviceState')
    ];

    selects.forEach(function (select) {
      if (!select) return;
      INDIAN_STATES.forEach(function (state) {
        var opt = document.createElement('option');
        opt.value = state;
        opt.textContent = state;
        select.appendChild(opt);
      });
    });
  }


  /* ── Setup real-time input listeners for validation feedback ── */
  function setupInputListeners() {
    // Clear error on typing
    var inputs = form.querySelectorAll('input, select, textarea');
    inputs.forEach(function (input) {
      input.addEventListener('input', function () {
        clearFieldError(input);
      });
      input.addEventListener('change', function () {
        clearFieldError(input);
      });
    });

    // Phone: allow only digits
    var phoneInput = document.getElementById('businessPhone');
    if (phoneInput) {
      phoneInput.addEventListener('input', function () {
        this.value = this.value.replace(/\D/g, '').slice(0, 10);
      });
    }

    // PIN codes: allow only digits
    ['businessPincode', 'servicePincode'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', function () {
          this.value = this.value.replace(/\D/g, '').slice(0, 6);
        });
      }
    });
  }


  /* ══════════════════════════════════════════════
     STEP NAVIGATION
     ══════════════════════════════════════════════ */

  function setupNavigationButtons() {
    // Next buttons
    bindClick('step1Next', function () { goToStep(2); });
    bindClick('step2Next', function () { goToStep(3); });
    bindClick('step3Next', function () { goToStep(4); });
    bindClick('step4Next', function () { goToStep(5); });

    // Previous buttons
    bindClick('step2Prev', function () { goToStep(1); });
    bindClick('step3Prev', function () { goToStep(2); });
    bindClick('step4Prev', function () { goToStep(3); });
    bindClick('step5Prev', function () { goToStep(4); });

    // Completed progress steps are clickable
    progressSteps.forEach(function (ps) {
      ps.addEventListener('click', function () {
        var stepNum = parseInt(ps.dataset.step);
        if (ps.classList.contains('completed')) {
          goToStep(stepNum, true);
        }
      });
    });
  }


  function goToStep(step, skipValidation) {
    // If going forward, validate current step first
    if (step > currentStep && !skipValidation) {
      if (!validateStep(currentStep)) {
        return;
      }
    }

    // If going to review, populate review data
    if (step === 5) {
      populateReview();
    }

    currentStep = step;
    updateUI();
    scrollToTop();
  }


  function updateUI() {
    // Update form steps
    formSteps.forEach(function (fs) {
      fs.classList.remove('active');
      if (parseInt(fs.dataset.step) === currentStep) {
        fs.classList.add('active');
      }
    });

    // Update progress indicator
    progressSteps.forEach(function (ps, index) {
      var stepNum = parseInt(ps.dataset.step);
      ps.classList.remove('active', 'completed');

      if (stepNum === currentStep) {
        ps.classList.add('active');
      } else if (stepNum < currentStep) {
        ps.classList.add('completed');
      }
    });

    // Update arrows
    progressArrows.forEach(function (arrow, idx) {
      arrow.classList.remove('active');
      if (idx < currentStep - 1) {
        arrow.classList.add('active');
      }
    });
  }


  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }


  /* ══════════════════════════════════════════════
     VALIDATION
     ══════════════════════════════════════════════ */

  function validateStep(step) {
    switch (step) {
      case 1: return validateStep1();
      case 2: return validateStep2();
      case 3: return validateStep3();
      case 4: return validateStep4();
      default: return true;
    }
  }


  /* ── Step 1: Business Info ── */
  function validateStep1() {
    var valid = true;

    var businessName = document.getElementById('businessName');
    var ownerName = document.getElementById('ownerName');
    var email = document.getElementById('businessEmail');
    var phone = document.getElementById('businessPhone');
    var address = document.getElementById('businessAddress');
    var city = document.getElementById('businessCity');
    var state = document.getElementById('businessState');
    var pincode = document.getElementById('businessPincode');

    // Business name
    if (!businessName.value.trim()) {
      showFieldError(businessName, 'businessName-error', 'Please enter your business name');
      valid = false;
    }

    // Owner name
    if (!ownerName.value.trim()) {
      showFieldError(ownerName, 'ownerName-error', 'Please enter the owner name');
      valid = false;
    }

    // Email
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.value.trim() || !emailRegex.test(email.value.trim())) {
      showFieldError(email, 'businessEmail-error', 'Please enter a valid email address');
      valid = false;
    }

    // Phone — 10 digits, starts with 6-9 for Indian numbers
    var phoneRegex = /^[6-9]\d{9}$/;
    if (!phone.value.trim() || !phoneRegex.test(phone.value.trim())) {
      showFieldError(phone, 'businessPhone-error', 'Please enter a valid 10-digit Indian phone number');
      valid = false;
    }

    // Address
    if (!address.value.trim()) {
      showFieldError(address, 'businessAddress-error', 'Please enter your business address');
      valid = false;
    }

    // City
    if (!city.value.trim()) {
      showFieldError(city, 'businessCity-error', 'Please enter your city');
      valid = false;
    }

    // State
    if (!state.value) {
      showFieldError(state, 'businessState-error', 'Please select your state');
      valid = false;
    }

    // Pincode — 6 digits, starts with 1-9
    var pincodeRegex = /^[1-9]\d{5}$/;
    if (!pincode.value.trim() || !pincodeRegex.test(pincode.value.trim())) {
      showFieldError(pincode, 'businessPincode-error', 'Please enter a valid 6-digit PIN code');
      valid = false;
    }

    if (!valid) {
      // Focus first error field
      var firstError = document.querySelector('#step-1 input.error, #step-1 select.error');
      if (firstError) firstError.focus();
    }

    return valid;
  }


  /* ── Step 2: Services ── */
  function validateStep2() {
    var valid = true;
    var checkboxes = form.querySelectorAll('input[name="services"]:checked');
    var servicesError = document.getElementById('services-error');

    if (checkboxes.length === 0) {
      servicesError.classList.add('visible');
      valid = false;
    } else {
      servicesError.classList.remove('visible');
    }

    // If "Other" is checked, description is required
    var otherChecked = document.getElementById('serviceOther').checked;
    if (otherChecked) {
      var desc = document.getElementById('otherServiceDescription');
      if (!desc.value.trim()) {
        showFieldError(desc, 'otherServiceDescription-error', 'Please describe your other service');
        valid = false;
      }
    }

    return valid;
  }


  /* ── Step 3: Service Area ── */
  function validateStep3() {
    var valid = true;

    var locality = document.getElementById('serviceLocality');
    var city = document.getElementById('serviceCity');
    var state = document.getElementById('serviceState');
    var pincode = document.getElementById('servicePincode');

    if (!locality.value.trim()) {
      showFieldError(locality, 'serviceLocality-error', 'Please enter your service area locality');
      valid = false;
    }

    if (!city.value.trim()) {
      showFieldError(city, 'serviceCity-error', 'Please enter the city');
      valid = false;
    }

    if (!state.value) {
      showFieldError(state, 'serviceState-error', 'Please select the state');
      valid = false;
    }

    var pincodeRegex = /^[1-9]\d{5}$/;
    if (!pincode.value.trim() || !pincodeRegex.test(pincode.value.trim())) {
      showFieldError(pincode, 'servicePincode-error', 'Please enter a valid 6-digit PIN code');
      valid = false;
    }

    if (!valid) {
      var firstError = document.querySelector('#step-3 input.error, #step-3 select.error');
      if (firstError) firstError.focus();
    }

    return valid;
  }


  /* ── Step 4: Documents ── */
  function validateStep4() {
    var valid = true;
    var requiredDocs = ['business_proof', 'identity_proof', 'registration_certificate'];

    requiredDocs.forEach(function (docType) {
      var errorEl = document.getElementById('docError-' + docType);
      if (uploadedFiles[docType].length === 0) {
        errorEl.classList.add('visible');
        valid = false;
      } else {
        errorEl.classList.remove('visible');
      }
    });

    return valid;
  }


  /* ── Field Error Helpers ── */
  function showFieldError(inputEl, errorId, message) {
    inputEl.classList.add('error');
    inputEl.classList.remove('valid');
    var errorEl = document.getElementById(errorId);
    if (errorEl) {
      errorEl.textContent = message || errorEl.textContent;
      errorEl.classList.add('visible');
    }
  }

  function clearFieldError(inputEl) {
    inputEl.classList.remove('error');
    var errorEl = document.getElementById(inputEl.id + '-error');
    if (errorEl) {
      errorEl.classList.remove('visible');
    }
  }


  /* ══════════════════════════════════════════════
     SERVICE CHECKBOXES
     ══════════════════════════════════════════════ */

  function setupServiceCheckboxes() {
    var otherCheckbox = document.getElementById('serviceOther');
    var otherInput = document.getElementById('otherServiceInput');
    var allCheckboxes = form.querySelectorAll('input[name="services"]');

    otherCheckbox.addEventListener('change', function () {
      if (this.checked) {
        otherInput.classList.add('visible');
      } else {
        otherInput.classList.remove('visible');
        document.getElementById('otherServiceDescription').value = '';
      }
    });

    // Clear service error when any checkbox changes
    allCheckboxes.forEach(function (cb) {
      cb.addEventListener('change', function () {
        var servicesError = document.getElementById('services-error');
        var checked = form.querySelectorAll('input[name="services"]:checked');
        if (checked.length > 0) {
          servicesError.classList.remove('visible');
        }
      });
    });
  }


  /* ══════════════════════════════════════════════
     FILE UPLOADS
     ══════════════════════════════════════════════ */

  var ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  var MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

  function setupFileUploads() {
    var uploadSections = document.querySelectorAll('.doc-upload-section');

    uploadSections.forEach(function (section) {
      var docType = section.dataset.docType;
      var zone = section.querySelector('.upload-zone');
      var fileInput = zone.querySelector('input[type="file"]');

      // Click to upload
      fileInput.addEventListener('change', function (e) {
        handleFiles(e.target.files, docType);
        e.target.value = ''; // Reset so same file can be re-selected
      });

      // Drag and drop
      zone.addEventListener('dragover', function (e) {
        e.preventDefault();
        zone.classList.add('drag-over');
      });

      zone.addEventListener('dragleave', function () {
        zone.classList.remove('drag-over');
      });

      zone.addEventListener('drop', function (e) {
        e.preventDefault();
        zone.classList.remove('drag-over');
        handleFiles(e.dataTransfer.files, docType);
      });
    });
  }


  function handleFiles(fileList, docType) {
    Array.from(fileList).forEach(function (file) {
      // Validate type
      if (!ALLOWED_TYPES.includes(file.type)) {
        showToast('Invalid file type: ' + file.name + '. Please use PDF, JPG, PNG or WEBP.', 'error');
        return;
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        showToast(file.name + ' is too large. Maximum file size is 5 MB.', 'error');
        return;
      }

      // Add to uploaded files
      var fileEntry = {
        file: file,
        id: generateFileId(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'ready'
      };

      uploadedFiles[docType].push(fileEntry);
      renderFileList(docType);

      // Clear doc error
      var errorEl = document.getElementById('docError-' + docType);
      if (errorEl) errorEl.classList.remove('visible');
    });
  }


  function renderFileList(docType) {
    var container = document.getElementById('fileList-' + docType);
    container.innerHTML = '';

    uploadedFiles[docType].forEach(function (fileEntry) {
      var item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML =
        '<div class="file-icon" aria-hidden="true">' + getFileIcon(fileEntry.type) + '</div>' +
        '<div class="file-details">' +
        '<div class="file-name">' + escapeHtml(fileEntry.name) + '</div>' +
        '<div class="file-meta">' + getFileTypeLabel(fileEntry.type) + ' · ' + formatFileSize(fileEntry.size) + '</div>' +
        '</div>' +
        '<span class="file-status">' + (fileEntry.status === 'ready' ? 'Ready' : 'Uploaded') + '</span>' +
        '<button type="button" class="file-remove" aria-label="Remove ' + escapeHtml(fileEntry.name) + '" data-file-id="' + fileEntry.id + '" data-doc-type="' + docType + '">×</button>';

      container.appendChild(item);
    });

    // Attach remove handlers
    container.querySelectorAll('.file-remove').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var fileId = this.dataset.fileId;
        var type = this.dataset.docType;
        uploadedFiles[type] = uploadedFiles[type].filter(function (f) { return f.id !== fileId; });
        renderFileList(type);
      });
    });
  }


  /* ══════════════════════════════════════════════
     REVIEW STEP
     ══════════════════════════════════════════════ */

  function setupEditButtons() {
    document.querySelectorAll('.review-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var step = parseInt(this.dataset.goto);
        goToStep(step, true);
      });
    });
  }


  function populateReview() {
    // Business info
    var bizGrid = document.getElementById('reviewBusiness');
    bizGrid.innerHTML = createReviewItem('Business Name', getVal('businessName')) +
      createReviewItem('Owner', getVal('ownerName')) +
      createReviewItem('Email', getVal('businessEmail')) +
      createReviewItem('Phone', getVal('businessPhone')) +
      createReviewItem('Address', getVal('businessAddress'), true) +
      createReviewItem('City', getVal('businessCity')) +
      createReviewItem('State', getVal('businessState')) +
      createReviewItem('PIN Code', getVal('businessPincode'));

    // Services
    var servicesContainer = document.getElementById('reviewServices');
    var selectedServices = getSelectedServices();
    var servicesHtml = '<div class="review-services">';
    selectedServices.forEach(function (s) {
      servicesHtml += '<span class="review-service-tag">' + escapeHtml(s) + '</span>';
    });
    servicesHtml += '</div>';

    var otherDesc = getVal('otherServiceDescription');
    if (otherDesc) {
      servicesHtml += '<div style="margin-top: 10px; font-size: 14px; color: var(--slate);">Other: ' + escapeHtml(otherDesc) + '</div>';
    }
    servicesContainer.innerHTML = servicesHtml;

    // Service area
    var areaGrid = document.getElementById('reviewArea');
    areaGrid.innerHTML = createReviewItem('Locality', getVal('serviceLocality'), true) +
      createReviewItem('City', getVal('serviceCity')) +
      createReviewItem('State', getVal('serviceState')) +
      createReviewItem('PIN Code', getVal('servicePincode'));

    var areaDesc = getVal('serviceDescription');
    if (areaDesc) {
      areaGrid.innerHTML += createReviewItem('Description', areaDesc, true);
    }

    // Documents
    var docsContainer = document.getElementById('reviewDocuments');
    var docsHtml = '';
    var docLabels = {
      business_proof: 'Business Proof',
      identity_proof: 'Identity Proof',
      registration_certificate: 'Registration Certificate',
      other_document: 'Other Document'
    };

    Object.keys(uploadedFiles).forEach(function (docType) {
      uploadedFiles[docType].forEach(function (f) {
        docsHtml += '<div class="review-doc-item">' +
          '<span class="doc-type-label">' + docLabels[docType] + '</span>' +
          '<span class="doc-file-name">' + escapeHtml(f.name) + '</span>' +
          '</div>';
      });
    });

    if (!docsHtml) {
      docsHtml = '<p style="font-size: 14px; color: var(--slate);">No documents uploaded</p>';
    }
    docsContainer.innerHTML = docsHtml;
  }


  function createReviewItem(label, value, fullWidth) {
    return '<div class="review-item' + (fullWidth ? ' full-width' : '') + '">' +
      '<div class="review-label">' + escapeHtml(label) + '</div>' +
      '<div class="review-value">' + escapeHtml(value || '—') + '</div>' +
      '</div>';
  }


  /* ══════════════════════════════════════════════
     FORM SUBMISSION
     ══════════════════════════════════════════════ */

  function setupFormSubmit() {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      handleSubmit();
    });
  }


  async function handleSubmit() {
    var submitBtn = document.getElementById('submitBtn');

    // Re-validate all steps
    for (var s = 1; s <= 4; s++) {
      if (!validateStep(s)) {
        goToStep(s, true);
        showToast('Please complete all required fields in step ' + s, 'error');
        return;
      }
    }

    // Disable submit button and show loading
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spinner"></span> Submitting…';

    try {
      if (!supabase) {
        throw new Error('Database connection unavailable. Please check your internet connection and try again.');
      }

      // 1. Generate application ID
      var appIdResult = await supabase.rpc('generate_application_id');

      if (appIdResult.error) {
        throw new Error('Failed to generate application ID: ' + appIdResult.error.message);
      }

      var applicationId = appIdResult.data;

      // 2. Prepare services array
      var services = getSelectedServices();
      // If "Cable TV + Broadband" is selected, expand it
      var expandedServices = [];
      services.forEach(function (s) {
        if (s === 'Cable TV + Broadband') {
          if (expandedServices.indexOf('Cable TV') === -1) expandedServices.push('Cable TV');
          if (expandedServices.indexOf('Broadband') === -1) expandedServices.push('Broadband');
        } else {
          if (expandedServices.indexOf(s) === -1) expandedServices.push(s);
        }
      });

      // 3. Insert application record
      var appData = {
        application_id: applicationId,
        business_name: getVal('businessName').trim(),
        owner_name: getVal('ownerName').trim(),
        email: getVal('businessEmail').trim().toLowerCase(),
        phone: getVal('businessPhone').trim(),
        address: getVal('businessAddress').trim(),
        city: getVal('businessCity').trim(),
        state: getVal('businessState'),
        pincode: getVal('businessPincode').trim(),
        services: expandedServices,
        other_service_description: getVal('otherServiceDescription').trim() || null,
        service_area_locality: getVal('serviceLocality').trim(),
        service_area_city: getVal('serviceCity').trim(),
        service_area_state: getVal('serviceState'),
        service_area_pincode: getVal('servicePincode').trim(),
        service_area_description: getVal('serviceDescription').trim() || null,
        status: 'PENDING'
      };

      var insertResult = await supabase
        .from('lco_applications')
        .insert([appData])
        .select('id')
        .single();

      if (insertResult.error) {
        throw new Error('Failed to save application: ' + insertResult.error.message);
      }

      var appUUID = insertResult.data.id;

      // 4. Upload documents to Supabase Storage and save references
      var docTypes = ['business_proof', 'identity_proof', 'registration_certificate', 'other_document'];

      for (var i = 0; i < docTypes.length; i++) {
        var docType = docTypes[i];
        var files = uploadedFiles[docType];

        for (var j = 0; j < files.length; j++) {
          var fileEntry = files[j];
          var filePath = applicationId + '/' + docType + '/' + Date.now() + '_' + sanitizeFileName(fileEntry.name);

          // Upload to storage
          var uploadResult = await supabase.storage
            .from('verification-documents')
            .upload(filePath, fileEntry.file, {
              cacheControl: '3600',
              upsert: false
            });

          if (uploadResult.error) {
            console.error('File upload error:', uploadResult.error);
            throw new Error('Failed to upload document: ' + fileEntry.name + '. ' + uploadResult.error.message);
          }

          // Save document reference
          var docRecord = {
            application_id: appUUID,
            document_type: docType,
            file_path: filePath,
            file_name: fileEntry.name,
            file_size: fileEntry.size,
            mime_type: fileEntry.type,
            status: 'PENDING'
          };

          var docInsert = await supabase
            .from('verification_documents')
            .insert([docRecord]);

          if (docInsert.error) {
            console.error('Document record error:', docInsert.error);
            throw new Error('Failed to save document record: ' + docInsert.error.message);
          }
        }
      }

      // 5. Success! Save to session and redirect
      sessionStorage.setItem('lco_app_id', applicationId);
      sessionStorage.setItem('lco_biz_name', appData.business_name);
      sessionStorage.setItem('lco_submitted_date', new Date().toISOString());

      showToast('Application submitted successfully!', 'success');

      // Redirect to status page after a brief delay
      setTimeout(function () {
        window.location.href = 'application-status.html?id=' +
          encodeURIComponent(applicationId) +
          '&biz=' + encodeURIComponent(appData.business_name) +
          '&date=' + encodeURIComponent(new Date().toISOString());
      }, 1200);

    } catch (error) {
      console.error('Submission error:', error);
      submitBtn.disabled = false;
      submitBtn.innerHTML = 'Submit Application';
      showToast(error.message || 'Something went wrong. Please try again.', 'error');
    }
  }


  /* ══════════════════════════════════════════════
     TOAST NOTIFICATIONS
     ══════════════════════════════════════════════ */

  function showToast(message, type) {
    var container = document.getElementById('toastContainer');
    var toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');

    var icon = '💬';
    if (type === 'error') icon = '⚠️';
    if (type === 'success') icon = '✓';

    toast.innerHTML = '<span class="toast-icon">' + icon + '</span>' + escapeHtml(message);
    container.appendChild(toast);

    // Auto-remove after 5s
    setTimeout(function () {
      toast.classList.add('removing');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 5000);
  }


  /* ══════════════════════════════════════════════
     UTILITY FUNCTIONS
     ══════════════════════════════════════════════ */

  function getVal(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }

  function getSelectedServices() {
    var checked = form.querySelectorAll('input[name="services"]:checked');
    return Array.from(checked).map(function (cb) { return cb.value; });
  }

  function bindClick(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function getFileIcon(mimeType) {
    if (mimeType === 'application/pdf') return '📑';
    if (mimeType.startsWith('image/')) return '🖼️';
    return '📄';
  }

  function getFileTypeLabel(mimeType) {
    var map = {
      'application/pdf': 'PDF',
      'image/jpeg': 'JPEG',
      'image/jpg': 'JPG',
      'image/png': 'PNG',
      'image/webp': 'WEBP'
    };
    return map[mimeType] || 'File';
  }

  function generateFileId() {
    return 'f_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  }

  function sanitizeFileName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }


  /* ══════════════════════════════════════════════
     BOOTSTRAP
     ══════════════════════════════════════════════ */

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
