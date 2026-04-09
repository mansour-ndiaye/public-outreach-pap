-- FIX 4: Add PFU (Phone Follow-Up) column to daily_entries
ALTER TABLE public.daily_entries
  ADD COLUMN IF NOT EXISTS pfu integer NOT NULL DEFAULT 0;
