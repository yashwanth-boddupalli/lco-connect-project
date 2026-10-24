-- ══════════════════════════════════════════════
-- Phase 11 Batch 2: Add notifications.category column
-- ══════════════════════════════════════════════
-- Why this exists:
--   The notification-center frontend (all three dashboards) filters by
--   `.eq('category', ...)` and renders category badges from it, and the
--   Phase-11 trigger functions INSERT with an explicit `category` value.
--   But no migration ever created the column — so depending on which SQL
--   files were run, those trigger INSERTs fail and service-request status
--   updates break. This migration adds the column. Idempotent: safe to
--   re-run on a database where it already exists.
--
-- Run AFTER: phase11-notification-architecture.sql,
--            phase11-batch1-notification-center-preferences.sql
-- ══════════════════════════════════════════════

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'SYSTEM';

-- Backfill: keep it simple — rows created before this column existed keep
-- the 'SYSTEM' default, which the frontend renders as a generic badge.

CREATE INDEX IF NOT EXISTS idx_notifications_category
  ON public.notifications (category);
