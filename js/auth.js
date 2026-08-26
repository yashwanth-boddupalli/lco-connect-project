/* ============================================
   LCO CONNECT — Shared Authentication Module
   Centralized authentication, role detection,
   and role-based routing for all user types.
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
    LCO_ADMIN:   null, // TODO: Future — LCO Admin dashboard
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
     GET CURRENT SESSION + ROLE
     Returns: { session, profile } or null
     ══════════════════════════════════════════════ */

  async function getSessionWithRole() {
    if (!sb) return null;

    try {
      var result = await sb.auth.getSession();
      if (!result.data || !result.data.session) return null;

      var session = result.data.session;

      // Fetch role from trusted profiles table
      var profileResult = await sb.from('profiles')
        .select('role, email')
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
     role and return routing information.
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

    // 2. Fetch role from trusted database profile
    var profileResult = await sb.from('profiles')
      .select('role, email')
      .eq('id', user.id)
      .single();

    if (profileResult.error || !profileResult.data) {
      // No profile found — sign out for security
      await sb.auth.signOut();
      throw new Error('Account setup incomplete. Please contact support.');
    }

    var role = profileResult.data.role;

    // 3. Determine dashboard redirect
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
     GUARD: Require specific role
     Used on protected pages to verify the user
     is authenticated AND has the required role.
     Redirects to login if not.
     ══════════════════════════════════════════════ */

  async function requireRole(requiredRole) {
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
