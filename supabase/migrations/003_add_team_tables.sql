-- =============================================================================
-- Public Outreach — PAP Territory Management
-- Migration 003: team_members + team_territories junction tables
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor → New query → Run

-- ---------------------------------------------------------------------------
-- 1. team_members — which users belong to each team
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_members (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, user_id)
);
COMMENT ON TABLE public.team_members IS 'Junction table: users (field_team) that belong to a team.';

CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_user_id ON public.team_members(user_id);


-- ---------------------------------------------------------------------------
-- 2. team_territories — which territories are assigned to each team
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_territories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  territory_id uuid        NOT NULL REFERENCES public.territories(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(team_id, territory_id)
);
COMMENT ON TABLE public.team_territories IS 'Junction table: territories assigned to a team.';

CREATE INDEX IF NOT EXISTS idx_team_territories_team_id ON public.team_territories(team_id);
CREATE INDEX IF NOT EXISTS idx_team_territories_territory_id ON public.team_territories(territory_id);


-- ---------------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.team_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_territories ENABLE ROW LEVEL SECURITY;

-- team_members
CREATE POLICY "team_members: authenticated can read"
  ON public.team_members FOR SELECT TO authenticated USING (true);

CREATE POLICY "team_members: managers can insert"
  ON public.team_members FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'territory_manager'));

CREATE POLICY "team_members: managers can delete"
  ON public.team_members FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'territory_manager'));

-- team_territories
CREATE POLICY "team_territories: authenticated can read"
  ON public.team_territories FOR SELECT TO authenticated USING (true);

CREATE POLICY "team_territories: managers can insert"
  ON public.team_territories FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'territory_manager'));

CREATE POLICY "team_territories: managers can delete"
  ON public.team_territories FOR DELETE TO authenticated
  USING (public.get_my_role() IN ('admin', 'territory_manager'));
