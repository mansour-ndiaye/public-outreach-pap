'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type DailyZoneRow = {
  id:          string
  team_id:     string
  assigned_by: string
  date:        string
  streets:     GeoJSON.FeatureCollection
  note:        string | null
  created_at:  string
}

export type DailyZoneWithTeam = DailyZoneRow & {
  team_name: string
}

export type TeamZoneStatus = {
  team_id:       string
  team_name:     string
  manager_name:  string | null
  territory_name: string | null
  zone_assigned:  boolean
  zone_id:       string | null
  last_eod_date: string | null
  last_pph:      number | null
}

// ── Fetch all daily zones (for manager map) ───────────────────────────────────
export async function fetchDailyZones(date?: string): Promise<DailyZoneWithTeam[]> {
  const supabase = createClient()

  let query = supabase.from('daily_zones').select('*').order('date', { ascending: false })
  if (date) query = query.eq('date', date)

  const { data: zones, error } = await query
  if (error || !zones) return []

  const rawZones = zones as DailyZoneRow[]

  // Resolve team names
  const teamIds = rawZones.map(z => z.team_id).filter((id, i, arr) => arr.indexOf(id) === i)
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .in('id', teamIds)

  const teamNames = new Map<string, string>()
  for (const t of (teams ?? []) as { id: string; name: string }[]) {
    teamNames.set(t.id, t.name)
  }

  return rawZones.map(z => ({
    ...z,
    team_name: teamNames.get(z.team_id) ?? z.team_id,
  }))
}

// ── Fetch teams with today's zone status (for manager Teams tab) ──────────────
export async function fetchTeamsWithZoneStatus(date: string): Promise<TeamZoneStatus[]> {
  const supabase = createClient()

  const [teamsRes, zonesRes, territoriesRes, membersRes, eodRes] = await Promise.all([
    supabase.from('teams').select('id, name, manager_id').order('name'),
    supabase.from('daily_zones').select('id, team_id, date').eq('date', date),
    supabase.from('team_territories').select('team_id, territory_id'),
    supabase.from('team_members').select('team_id, user_id'),
    supabase.from('daily_entries').select('team_id, entry_date, pph').not('team_id', 'is', null).order('entry_date', { ascending: false }),
  ])

  const teams       = (teamsRes.data ?? [])       as { id: string; name: string; manager_id: string | null }[]
  const zones       = (zonesRes.data ?? [])       as { id: string; team_id: string; date: string }[]
  const territories = (territoriesRes.data ?? []) as { team_id: string; territory_id: string }[]
  const entries     = (eodRes.data ?? [])         as { team_id: string; entry_date: string; pph: number }[]

  // Resolve territory names
  const allTerritoryIds = territories.map(t => t.territory_id).filter((id, i, arr) => arr.indexOf(id) === i)
  let territoryNames = new Map<string, string>()
  if (allTerritoryIds.length > 0) {
    const { data: terrs } = await supabase.from('territories').select('id, name').in('id', allTerritoryIds)
    for (const tr of (terrs ?? []) as { id: string; name: string }[]) {
      territoryNames.set(tr.id, tr.name)
    }
  }

  // Resolve manager names
  const managerIds = teams.map(t => t.manager_id).filter(Boolean) as string[]
  const uniqueManagerIds = managerIds.filter((id, i, arr) => arr.indexOf(id) === i)
  let managerNames = new Map<string, string>()
  if (uniqueManagerIds.length > 0) {
    const { data: mgrs } = await supabase.from('users').select('id, full_name, email').in('id', uniqueManagerIds)
    for (const m of (mgrs ?? []) as { id: string; full_name: string | null; email: string }[]) {
      managerNames.set(m.id, m.full_name || m.email)
    }
  }

  // Build lookup maps
  const zoneByTeam = new Map<string, string>()
  for (const z of zones) zoneByTeam.set(z.team_id, z.id)

  const territoryByTeam = new Map<string, string>()
  for (const t of territories) {
    if (!territoryByTeam.has(t.team_id)) territoryByTeam.set(t.team_id, t.territory_id)
  }

  // Last EOD per team
  const lastEodByTeam = new Map<string, { date: string; pph: number }>()
  for (const e of entries) {
    if (!lastEodByTeam.has(e.team_id)) {
      lastEodByTeam.set(e.team_id, { date: e.entry_date, pph: e.pph })
    }
  }

  return teams.map(team => {
    const territoryId = territoryByTeam.get(team.id)
    const lastEod = lastEodByTeam.get(team.id)
    return {
      team_id:        team.id,
      team_name:      team.name,
      manager_name:   team.manager_id ? (managerNames.get(team.manager_id) ?? null) : null,
      territory_name: territoryId ? (territoryNames.get(territoryId) ?? null) : null,
      zone_assigned:  zoneByTeam.has(team.id),
      zone_id:        zoneByTeam.get(team.id) ?? null,
      last_eod_date:  lastEod?.date ?? null,
      last_pph:       lastEod?.pph ?? null,
    }
  })
}

// ── Create / upsert a daily zone ──────────────────────────────────────────────
export async function createDailyZone(data: {
  team_id:  string
  date:     string
  streets:  GeoJSON.FeatureCollection
  note:     string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zone, error } = await (supabase as any)
    .from('daily_zones')
    .upsert(
      {
        team_id:     data.team_id,
        assigned_by: user.user.id,
        date:        data.date,
        streets:     data.streets,
        note:        data.note || null,
      },
      { onConflict: 'team_id,date' }
    )
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !zone) return { error: error?.message ?? 'Failed to create zone' }

  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')

  return { id: zone.id }
}
