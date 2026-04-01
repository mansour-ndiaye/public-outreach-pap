-- =============================================================================
-- Public Outreach — PAP Territory Management
-- Migration 001: Initial Schema
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor → New query → Run


-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";


-- ---------------------------------------------------------------------------
-- 1. Enumerations
-- ---------------------------------------------------------------------------
create type public.user_role as enum (
  'admin',
  'territory_manager',
  'supervisor',
  'field_team'
);

create type public.territory_status as enum (
  'active',
  'inactive',
  'pending'
);

create type public.assignment_status as enum (
  'pending',
  'in_progress',
  'completed'
);


-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- users
-- Mirrors auth.users; auto-populated via trigger on sign-up.
create table public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null unique,
  full_name   text,
  role        public.user_role not null default 'field_team',
  created_at  timestamptz not null default now()
);
comment on table public.users is
  'Public Outreach staff profiles, linked 1-to-1 with Supabase Auth users.';


-- territories
-- Replaces Google My Maps. Each territory is a named canvassing zone.
create table public.territories (
  id          uuid              primary key default gen_random_uuid(),
  name        text              not null,
  sector      text,
  status      public.territory_status not null default 'active',
  created_at  timestamptz       not null default now()
);
comment on table public.territories is
  'Canvassing zones (terrains) assigned to field teams.';


-- teams
create table public.teams (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,
  manager_id  uuid        references public.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
comment on table public.teams is
  'Field teams, each led by a territory manager.';


-- assignments
-- Links a team to a territory for a specific date, tracking street progress.
create table public.assignments (
  id              uuid                    primary key default gen_random_uuid(),
  team_id         uuid                    not null references public.teams(id) on delete cascade,
  territory_id    uuid                    not null references public.territories(id) on delete cascade,
  date            date                    not null,
  streets_total   integer                 not null default 0 check (streets_total >= 0),
  streets_done    integer                 not null default 0 check (streets_done >= 0),
  recalls         integer                 not null default 0 check (recalls >= 0),
  status          public.assignment_status not null default 'pending',
  created_at      timestamptz             not null default now(),
  constraint streets_done_lte_total check (streets_done <= streets_total)
);
comment on table public.assignments is
  'Daily territory assignments linking a team to a terrain for a given date.';


-- daily_entries
-- PAC performance data entered after each canvassing session.
-- PPH (PAC Per Hour) is the primary KPI for Public Outreach field teams.
create table public.daily_entries (
  id               uuid        primary key default gen_random_uuid(),
  assignment_id    uuid        not null references public.assignments(id) on delete cascade,
  pac_count        integer     not null default 0 check (pac_count >= 0),
  pac_total_amount numeric(10,2) not null default 0 check (pac_total_amount >= 0),
  pac_average      numeric(10,2) not null default 0 check (pac_average >= 0),
  pph              numeric(10,2) not null default 0 check (pph >= 0),
  recalls_count    integer     not null default 0 check (recalls_count >= 0),
  created_at       timestamptz not null default now()
);
comment on table public.daily_entries is
  'Per-session PAC performance data. pac_average = pac_total_amount / pac_count. pph = PAC Per Hour (main KPI).';


-- ---------------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------------
create index on public.assignments (team_id);
create index on public.assignments (territory_id);
create index on public.assignments (date);
create index on public.daily_entries (assignment_id);
create index on public.teams (manager_id);


-- ---------------------------------------------------------------------------
-- 4. Trigger: auto-create user profile on sign-up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(
      (new.raw_user_meta_data->>'role')::public.user_role,
      'field_team'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ---------------------------------------------------------------------------
-- 5. Helper: get current user role (used in RLS policies)
-- ---------------------------------------------------------------------------
create or replace function public.get_my_role()
returns public.user_role
language sql
security definer stable
as $$
  select role from public.users where id = auth.uid();
$$;


-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------

alter table public.users       enable row level security;
alter table public.territories enable row level security;
alter table public.teams       enable row level security;
alter table public.assignments enable row level security;
alter table public.daily_entries enable row level security;


-- ── users ─────────────────────────────────────────────────────────────────

-- Any authenticated user can read the full user list
-- (needed for manager dropdowns, team member listings, etc.)
create policy "users: authenticated can read all"
  on public.users for select
  to authenticated
  using (true);

-- Each user can update their own profile
create policy "users: can update own profile"
  on public.users for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Only admins can insert/delete user rows (normal path is via Auth trigger)
create policy "users: admin full access"
  on public.users for all
  to authenticated
  using (public.get_my_role() = 'admin')
  with check (public.get_my_role() = 'admin');


-- ── territories ───────────────────────────────────────────────────────────

-- All authenticated users can view territories
create policy "territories: authenticated can read"
  on public.territories for select
  to authenticated
  using (true);

-- Admins and territory managers can create/edit/delete territories
create policy "territories: managers can write"
  on public.territories for insert
  to authenticated
  with check (public.get_my_role() in ('admin', 'territory_manager'));

create policy "territories: managers can update"
  on public.territories for update
  to authenticated
  using  (public.get_my_role() in ('admin', 'territory_manager'))
  with check (public.get_my_role() in ('admin', 'territory_manager'));

create policy "territories: admin can delete"
  on public.territories for delete
  to authenticated
  using (public.get_my_role() = 'admin');


-- ── teams ─────────────────────────────────────────────────────────────────

-- All authenticated users can view teams
create policy "teams: authenticated can read"
  on public.teams for select
  to authenticated
  using (true);

-- Admins and territory managers can manage teams
create policy "teams: managers can write"
  on public.teams for insert
  to authenticated
  with check (public.get_my_role() in ('admin', 'territory_manager'));

create policy "teams: managers can update"
  on public.teams for update
  to authenticated
  using  (public.get_my_role() in ('admin', 'territory_manager'))
  with check (public.get_my_role() in ('admin', 'territory_manager'));

create policy "teams: admin can delete"
  on public.teams for delete
  to authenticated
  using (public.get_my_role() = 'admin');


-- ── assignments ───────────────────────────────────────────────────────────

-- Admins and territory managers see all assignments.
-- Supervisors and field team only see assignments for their own team.
create policy "assignments: read own team or manager"
  on public.assignments for select
  to authenticated
  using (
    public.get_my_role() in ('admin', 'territory_manager')
    or team_id in (
      select id from public.teams where manager_id = auth.uid()
    )
    or team_id in (
      -- field_team / supervisor: see assignments for teams they belong to
      -- (team membership will be tracked via users.team_id in a future migration)
      select id from public.teams where id = team_id
    )
  );

-- Admins, territory managers, and supervisors can create assignments
create policy "assignments: managers and supervisors can insert"
  on public.assignments for insert
  to authenticated
  with check (public.get_my_role() in ('admin', 'territory_manager', 'supervisor'));

create policy "assignments: managers and supervisors can update"
  on public.assignments for update
  to authenticated
  using  (public.get_my_role() in ('admin', 'territory_manager', 'supervisor'))
  with check (public.get_my_role() in ('admin', 'territory_manager', 'supervisor'));

create policy "assignments: admin can delete"
  on public.assignments for delete
  to authenticated
  using (public.get_my_role() = 'admin');


-- ── daily_entries ─────────────────────────────────────────────────────────

-- Admins, territory managers, and supervisors see all entries.
-- Field team can see entries for their own assignments.
create policy "daily_entries: read own or manager"
  on public.daily_entries for select
  to authenticated
  using (
    public.get_my_role() in ('admin', 'territory_manager', 'supervisor')
    or assignment_id in (
      select a.id from public.assignments a
      inner join public.teams t on t.id = a.team_id
      where t.manager_id = auth.uid()
    )
  );

-- Any authenticated user can submit daily entries
create policy "daily_entries: authenticated can insert"
  on public.daily_entries for insert
  to authenticated
  with check (true);

-- Admins and territory managers can edit/delete entries
create policy "daily_entries: managers can update"
  on public.daily_entries for update
  to authenticated
  using  (public.get_my_role() in ('admin', 'territory_manager'))
  with check (public.get_my_role() in ('admin', 'territory_manager'));

create policy "daily_entries: admin can delete"
  on public.daily_entries for delete
  to authenticated
  using (public.get_my_role() = 'admin');
