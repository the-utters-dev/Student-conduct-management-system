-- N4 — Rwanda Location Fields (idempotent)
-- Add complete Rwanda administrative hierarchy fields to students table
-- Run this after n3-terms.sql

-- =============================================================================
-- Add location columns to students table
-- =============================================================================

-- Add province column
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS province text;

-- Add district column (keep existing for backward compatibility)
-- Note: district may already exist from earlier migrations

-- Add sector column
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS sector text;

-- Add cell column
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS cell text;

-- Add village column
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS village text;

-- Add comments for documentation
COMMENT ON COLUMN public.students.province IS 'Rwanda province (KIGALI, EAST, WEST, NORTH, SOUTH)';
COMMENT ON COLUMN public.students.district IS 'Rwanda district (e.g., Gasabo, Nyarugenge, Kicukiro)';
COMMENT ON COLUMN public.students.sector IS 'Rwanda sector';
COMMENT ON COLUMN public.students.cell IS 'Rwanda cell';
COMMENT ON COLUMN public.students.village IS 'Rwanda village';

-- =============================================================================
-- Summary
-- =============================================================================
-- This script adds the complete Rwanda administrative hierarchy to students:
-- - province (e.g., KIGALI, EAST, WEST, NORTH, SOUTH)
-- - district (e.g., Gasabo, Nyarugenge, Kicukiro)
-- - sector (e.g., Kacyiru, Kimironko, Remera)
-- - cell (administrative subdivision of sector)
-- - village (smallest administrative unit)
--
-- All columns are nullable to allow gradual migration and support
-- students who may not have complete location data.
-- The app provides "Not in list" options to handle edge cases.
