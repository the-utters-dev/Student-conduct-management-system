-- SCDMS: Phase 2a — Add new role enum values.
-- Run manually in Supabase SQL editor. Idempotent (safe to run twice).
-- IMPORTANT: Run this FIRST, then phase2b-roles.sql in a SEPARATE transaction.
-- PostgreSQL requires new enum values to be added in a separate transaction
-- from the one that uses them.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'school_director';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master_of_discipline';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'matron';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'patron';
