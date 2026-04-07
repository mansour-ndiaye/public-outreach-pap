-- =============================================================================
-- Public Outreach — PAP Territory Management
-- Migration 004: daily_zones table + daily_entries new columns
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor → New query → Run

-- ---------------------------------------------------------------------------
-- 1. daily_zones — Alicia assigns daily street routes to teams
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_zones (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  assigned_by uuid        NOT NULL REFERENCES public.users(id),
  date        date        NOT NULL,
  streets     jsonb       NOT NULL DEFAULT '{"type":"FeatureCollection","features":[]}',
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, date)
);

COMMENT ON TABLE public.daily_zones IS 'Daily street-route zones assigned by territory manager to each team.';

CREATE INDEX IF NOT EXISTS idx_daily_zones_team_id ON public.daily_zones(team_id);
CREATE INDEX IF NOT EXISTS idx_daily_zones_date    ON public.daily_zones(date);

-- ---------------------------------------------------------------------------
-- 2. Extend daily_entries with new columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_entries
  ALTER COLUMN assignment_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS team_id         uuid    REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS entry_date      date,
  ADD COLUMN IF NOT EXISTS covered_streets jsonb   DEFAULT '{"type":"FeatureCollection","features":[]}',
  ADD COLUMN IF NOT EXISTS canvas_hours    numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS note            text;

-- Prevent duplicate EOD per team per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_entries_team_date
  ON public.daily_entries(team_id, entry_date)
  WHERE team_id IS NOT NULL AND entry_date IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Row Level Security for daily_zones
-- ---------------------------------------------------------------------------
ALTER TABLE public.daily_zones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_zones: authenticated can read"
  ON public.daily_zones FOR SELECT TO authenticated USING (true);

CREATE POLICY "daily_zones: managers can insert"
  ON public.daily_zones FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'territory_manager'));

CREATE POLICY "daily_zones: managers can update"
  ON public.daily_zones FOR UPDATE TO authenticated
  USING (public.get_my_role() IN ('admin', 'territory_manager'));

CREATE POLICY "daily_zones: managers can delete"
  ON public.daily_zones FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'territory_manager'));

-- ---------------------------------------------------------------------------
-- 4. RLS policies for daily_entries (new EOD submissions by supervisors)
-- ---------------------------------------------------------------------------
-- Read: all authenticated (manager needs to see all teams' data)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_entries' AND policyname = 'daily_entries: authenticated can read'
  ) THEN
    CREATE POLICY "daily_entries: authenticated can read"
      ON public.daily_entries FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'daily_entries' AND policyname = 'daily_entries: supervisors can insert'
  ) THEN
    CREATE POLICY "daily_entries: supervisors can insert"
      ON public.daily_entries FOR INSERT TO authenticated
      WITH CHECK (public.get_my_role() IN ('admin', 'territory_manager', 'supervisor'));
  END IF;
END $$;
