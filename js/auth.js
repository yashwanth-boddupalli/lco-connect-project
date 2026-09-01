/* ============================================
   LCO CONNECT — Shared Authentication Module
   Centralized authentication, role detection,
   status checking, and role-based routing.
   ============================================ */

var LCOAuth = (function () {
  'use strict';

  /* ── Supabase config ── */
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
     ROLE-BASED ROUTING TABLE
     ══════════════════════════════════════════════
     Maps each role to its dashboard page.
     Future roles can be added here with their
     corresponding dashboard URL.
     ══════════════════════════════════════════════ */

  var ROLE_ROUTES = {
    SUPER_ADMIN: 'super-admin.html',
    LCO_ADMIN:   'lco-dashboard.html',
    CUSTOMER:    null, // TODO: Future — Customer dashboard
    TECHNICIAN:  null  // TODO: Future — Technician dashboard
  };

  /* Common login page (relative to /pages/) */
  var LOGIN_PAGE = 'login.html';


  /* ══════════════════════════════════════════════
     GET SUPABASE CLIENT
     ══════════════════════════════════════════════ */

  function getClient() {
    return sb;
  }


  /* ══════════════════════════════════════════════
     GET CURRENT SESSION + ROLE + STATUS
     Returns: { session, profile } or null
     ══════════════════════════════════════════════ */

  async function getSessionWithRole() {
    if (!sb) return null;

    try {
      var session = null;

      // First attempt: direct getSession
      var result = await sb.auth.getSession();
      if (result.data && result.data.session) {
        session = result.data.session;
      }

      // If no session yet, wait for Supabase to restore from storage.
      // This handles the race condition after a cross-page redirect
      // where localStorage session hasn't been parsed yet.
      if (!session) {
        session = await new Promise(function (resolve) {
          var timeout = setTimeout(function () {
            sub.unsubscribe();
            resolve(null);
          }, 3000);

          var sub = sb.auth.onAuthStateChange(function (event, s) {
            if (s) {
              clearTimeout(timeout);
              // Small delay to allow unsubscribe to exist
              setTimeout(function () { sub.unsubscribe(); }, 0);
              resolve(s);
            } else if (event === 'INITIAL_SESSION') {
              // INITIAL_SESSION with null session means truly no session
              clearTimeout(timeout);
              setTimeout(function () { sub.unsubscribe(); }, 0);
              resolve(null);
            }
          });

          // onAuthStateChange returns { data: { subscription } }
          sub = sub.data.subscription;
        });
      }

      if (!session) return null;

      // Fetch role AND status from trusted profiles table
      var profileResult = await sb.from('profiles')
        .select('role, email, status')
        .eq('id', session.user.id)
        .single();

      if (profileResult.error || !profileResult.data) return null;

      return {
        session: session,
        profile: profileResult.data
      };
    } catch (e) {
      console.error('Session check failed:', e);
      return null;
    }
  }


  /* ══════════════════════════════════════════════
     SIGN IN
     Authenticate with email/password, then fetch
     role/status and return routing information.
     ══════════════════════════════════════════════ */

  async function signIn(email, password) {
    if (!sb) throw new Error('Connection unavailable. Please try again.');

    // 1. Authenticate with Supabase
    var authResult = await sb.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (authResult.error) throw authResult.error;

    var user = authResult.data.user;

    // 2. Fetch role and status from trusted database profile
    var profileResult = await sb.from('profiles')
      .select('role, email, status')
      .eq('id', user.id)
      .single();

    if (profileResult.error || !profileResult.data) {
      // Log the actual error for debugging — not shown to user
      console.error('Profile lookup failed for user:', user.id,
        'Error:', profileResult.error,
        'Data:', profileResult.data);
      // No profile found — sign out for security
      await sb.auth.signOut();
      throw new Error('Account setup incomplete. Please contact support.');
    }

    var role = profileResult.data.role;
    var status = profileResult.data.status;

    // 3. Check account status BEFORE routing
    // SUPER_ADMIN is always active
    if (role !== 'SUPER_ADMIN') {
      if (status === 'PENDING') {
        await sb.auth.signOut();
        throw new Error('Your account is pending verification. You will be notified once your application is reviewed.');
      }
      if (status === 'REJECTED') {
        await sb.auth.signOut();
        throw new Error('Your LCO application was not approved. Please contact support if you need more information.');
      }
      if (status === 'SUSPENDED' || status !== 'ACTIVE') {
        await sb.auth.signOut();
        throw new Error('Your account is not active. Please contact support for assistance.');
      }
    }

    // 4. Determine dashboard redirect
    var dashboardUrl = ROLE_ROUTES[role] || null;

    if (!dashboardUrl) {
      // Known role but no dashboard built yet
      if (ROLE_ROUTES.hasOwnProperty(role)) {
        await sb.auth.signOut();
        throw new Error('Your dashboard (' + role + ') is coming soon. Please check back later.');
      }
      // Unknown role
      await sb.auth.signOut();
      throw new Error('Access denied. Unrecognized account role.');
    }

    return {
      user: user,
      role: role,
      status: status,
      email: profileResult.data.email || user.email,
      redirectUrl: dashboardUrl
    };
  }


  /* ══════════════════════════════════════════════
     SIGN OUT
     ══════════════════════════════════════════════ */

  async function signOut() {
    if (sb) {
      try {
        await sb.auth.signOut();
      } catch (e) { /* ignore */ }
    }
  }


  /* ══════════════════════════════════════════════
     GUARD: Require specific role (and optionally status)
     Used on protected pages to verify the user
     is authenticated AND has the required role
     AND (optionally) the required status.
     Redirects to login if not.
     ══════════════════════════════════════════════ */

  async function requireRole(requiredRole, requiredStatus) {
    var data = await getSessionWithRole();

    if (!data) {
      redirectToLogin();
      return null;
    }

    if (data.profile.role !== requiredRole) {
      // Authenticated but wrong role
      await signOut();
      redirectToLogin();
      return null;
    }

    // Check status if required (SUPER_ADMIN bypasses status check)
    if (requiredStatus && requiredRole !== 'SUPER_ADMIN') {
      if (data.profile.status !== requiredStatus) {
        await signOut();
        redirectToLogin();
        return null;
      }
    }

    return {
      session: data.session,
      profile: data.profile
    };
  }


  /* ══════════════════════════════════════════════
     REDIRECT TO LOGIN
     Determines correct path based on current
     page location.
     ══════════════════════════════════════════════ */

  function redirectToLogin() {
    // We are in the /pages/ directory
    window.location.href = LOGIN_PAGE;
  }


  /* ══════════════════════════════════════════════
     PUBLIC API
     ══════════════════════════════════════════════ */

  return {
    getClient: getClient,
    getSessionWithRole: getSessionWithRole,
    signIn: signIn,
    signOut: signOut,
    requireRole: requireRole,
    redirectToLogin: redirectToLogin,
    ROLE_ROUTES: ROLE_ROUTES,
    LOGIN_PAGE: LOGIN_PAGE
  };

})();
