'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TeamWithDetails, UserRow, TerritoryRow } from '@/types'

function revalidateTeamPaths() {
  revalidatePath('/fr/admin/teams')
  revalidatePath('/en/admin/teams')
  revalidatePath('/fr/admin/dashboard')
  revalidatePath('/en/admin/dashboard')
}

// ── Fetch teams with manager name + member/territory id lists ─────────────────
export async function fetchTeamsWithDetails(): Promise<TeamWithDetails[]> {
  const supabase = createClient()

  const [teamsRes, membersRes, territoriesRes] = await Promise.all([
    supabase.from('teams').select('*').order('name', { ascending: true }),
    supabase.from('team_members').select('team_id, user_id'),
    supabase.from('team_territories').select('team_id, territory_id'),
  ])

  const teams = (teamsRes.data ?? []) as { id: string; name: string; created_at: string; manager_id: string | null }[]

  // Resolve manager names in one query
  const managerIdSet = teams.map(t => t.manager_id).filter(Boolean) as string[]
  const managerIds = managerIdSet.filter((id, i) => managerIdSet.indexOf(id) === i)
  let managerNames = new Map<string, string>()
  if (managerIds.length > 0) {
    const { data: mgrs } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', managerIds)
    for (const m of (mgrs ?? []) as { id: string; full_name: string | null; email: string }[]) {
      managerNames.set(m.id, m.full_name || m.email)
    }
  }

  // Build lookup maps
  const membersByTeam = new Map<string, string[]>()
  for (const m of (membersRes.data ?? []) as { team_id: string; user_id: string }[]) {
    const arr = membersByTeam.get(m.team_id) ?? []
    arr.push(m.user_id)
    membersByTeam.set(m.team_id, arr)
  }

  const territoriesByTeam = new Map<string, string[]>()
  for (const t of (territoriesRes.data ?? []) as { team_id: string; territory_id: string }[]) {
    const arr = territoriesByTeam.get(t.team_id) ?? []
    arr.push(t.territory_id)
    territoriesByTeam.set(t.team_id, arr)
  }

  return teams.map(team => ({
    id:            team.id,
    name:          team.name,
    created_at:    team.created_at,
    manager_id:    team.manager_id,
    manager_name:  team.manager_id ? (managerNames.get(team.manager_id) ?? null) : null,
    member_ids:    membersByTeam.get(team.id) ?? [],
    territory_ids: territoriesByTeam.get(team.id) ?? [],
  }))
}

// ── Fetch users who can be managers (admin + territory_manager) ───────────────
export async function fetchManagerUsers(): Promise<Pick<UserRow, 'id' | 'full_name' | 'email'>[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email')
    .in('role', ['admin', 'territory_manager'])
    .order('full_name', { ascending: true })
  return (data ?? []) as Pick<UserRow, 'id' | 'full_name' | 'email'>[]
}

// ── Fetch field team members ──────────────────────────────────────────────────
export async function fetchFieldUsers(): Promise<Pick<UserRow, 'id' | 'full_name' | 'email'>[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('role', 'field_team')
    .order('full_name', { ascending: true })
  return (data ?? []) as Pick<UserRow, 'id' | 'full_name' | 'email'>[]
}

// ── Create team ───────────────────────────────────────────────────────────────
export async function createTeam(data: {
  name: string
  manager_id: string | null
  member_ids: string[]
  territory_ids: string[]
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()

  // 1. Insert team
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team, error: teamError } = await (supabase as any)
    .from('teams')
    .insert({ name: data.name, manager_id: data.manager_id || null })
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (teamError || !team) return { error: teamError?.message ?? 'Failed to create team' }

  const teamId = team.id

  // 2. Insert members
  if (data.member_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('team_members')
      .insert(data.member_ids.map(user_id => ({ team_id: teamId, user_id })))
    if (error) return { error: error.message }
  }

  // 3. Insert territories
  if (data.territory_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('team_territories')
      .insert(data.territory_ids.map(territory_id => ({ team_id: teamId, territory_id })))
    if (error) return { error: error.message }
  }

  revalidateTeamPaths()
  return { id: teamId }
}

// ── Update team ───────────────────────────────────────────────────────────────
export async function updateTeam(
  teamId: string,
  data: {
    name: string
    manager_id: string | null
    member_ids: string[]
    territory_ids: string[]
  }
): Promise<{ error?: string }> {
  const supabase = createClient()

  // 1. Update team row
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateError } = await (supabase as any)
    .from('teams')
    .update({ name: data.name, manager_id: data.manager_id || null })
    .eq('id', teamId) as { error: { message: string } | null }
  if (updateError) return { error: updateError.message }

  // 2. Sync members: delete all, re-insert
  const { error: delMembersErr } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', teamId)
  if (delMembersErr) return { error: delMembersErr.message }

  if (data.member_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('team_members')
      .insert(data.member_ids.map(user_id => ({ team_id: teamId, user_id })))
    if (error) return { error: error.message }
  }

  // 3. Sync territories: delete all, re-insert
  const { error: delTerrErr } = await supabase
    .from('team_territories')
    .delete()
    .eq('team_id', teamId)
  if (delTerrErr) return { error: delTerrErr.message }

  if (data.territory_ids.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('team_territories')
      .insert(data.territory_ids.map(territory_id => ({ team_id: teamId, territory_id })))
    if (error) return { error: error.message }
  }

  revalidateTeamPaths()
  return {}
}

// ── Delete team ───────────────────────────────────────────────────────────────
export async function deleteTeam(teamId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  // Cascade on team_members + team_territories is handled by FK ON DELETE CASCADE
  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  if (error) return { error: error.message }
  revalidateTeamPaths()
  return {}
}

// ── Re-export TerritoryRow for convenience ────────────────────────────────────
export type { TerritoryRow }
