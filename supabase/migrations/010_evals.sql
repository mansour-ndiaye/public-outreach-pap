-- Migration 010: Create evals table for post-EOD evaluation questionnaires

CREATE TABLE IF NOT EXISTS public.evals (
  id                    uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  eod_entry_id          uuid            REFERENCES public.daily_entries(id) ON DELETE SET NULL,
  supervisor_id         uuid            REFERENCES public.users(id)         ON DELETE SET NULL,
  supervisor_name       text,
  team_id               uuid            REFERENCES public.teams(id)         ON DELETE SET NULL,
  team_name             text,
  eval_date             date            NOT NULL,
  eval_day              text            NOT NULL,   -- D1, D2, D3, D4, D5
  eval_name             text            NOT NULL,   -- name of person being evaluated
  coached_by_supervisor boolean         NOT NULL DEFAULT true,
  coach_name            text,                       -- populated when coached_by_supervisor = false
  eval_pph              numeric(10, 2)  NOT NULL DEFAULT 0,
  eval_canvas_hours     numeric(5, 2),
  eval_pac_total        numeric(10, 2),
  notes                 text,
  created_at            timestamptz     NOT NULL DEFAULT now()
);

-- Row-level security
ALTER TABLE public.evals ENABLE ROW LEVEL SECURITY;

-- Supervisors can insert their own evals
CREATE POLICY "supervisors_insert_own_evals" ON public.evals
  FOR INSERT TO authenticated
  WITH CHECK (supervisor_id = auth.uid());

-- Supervisors can read their own evals
CREATE POLICY "supervisors_read_own_evals" ON public.evals
  FOR SELECT TO authenticated
  USING (supervisor_id = auth.uid());

-- Admins and territory_managers can read all evals
CREATE POLICY "managers_read_all_evals" ON public.evals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
        AND role IN ('admin', 'territory_manager')
    )
  );

-- Indexes
CREATE INDEX IF NOT EXISTS evals_supervisor_id_idx ON public.evals (supervisor_id);
CREATE INDEX IF NOT EXISTS evals_eval_date_idx     ON public.evals (eval_date DESC);
CREATE INDEX IF NOT EXISTS evals_team_id_idx       ON public.evals (team_id);
CREATE INDEX IF NOT EXISTS evals_eval_day_idx      ON public.evals (eval_day);
