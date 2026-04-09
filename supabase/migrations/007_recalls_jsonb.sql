-- FIX 4: Replace recalls_count integer with recalls JSONB array
-- Each entry: { street: string, postal_code: string, numbers: string[] }
ALTER TABLE public.daily_entries
  ADD COLUMN IF NOT EXISTS recalls jsonb NOT NULL DEFAULT '[]';
