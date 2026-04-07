'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TerritoryRow } from '@/types'
import type { DailyZoneRow } from './zone-actions'

export type EODEntry = {
  id:               string
  assignment_id:    string | null
  team_id:          string | null
  entry_date:       string | null
  pac_count:        number
  pac_total_amount: number
  pac_average:      number
  pph:              number
  recalls_count:    number
  canvas_hours:     number | null
  note:             string | null
  covered_streets:  GeoJSON.FeatureCollection | null
  created_at:       string
}

export type EODWithTeam = EODEntry & {
  team_name: string | null
}

export type SupervisorTeam = {
  teamId:   string
  teamName: string
}

// ── Get current supervisor's team ─────────────────────────────────────────────
export async function fetchSupervisorTeam(): Promise<SupervisorTeam | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: membership } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', user.id)
    .single() as { data: { team_id: string } | null; error: unknown }

  if (!membership) return null

  const { data: team } = await supabase
    .from('teams')
    .select('id, name')
    .eq('id', membership.team_id)
    .single() as { data: { id: string; name: string } | null; error: unknown }

  if (!team) return null
  return { teamId: team.id, teamName: team.name }
}

// ── Get the supervisor's team territory (polygon) ─────────────────────────────
export async function fetchSupervisorTerritory(teamId: string): Promise<TerritoryRow | null> {
  const supabase = createClient()

  const { data: link } = await supabase
    .from('team_territories')
    .select('territory_id')
    .eq('team_id', teamId)
    .single() as { data: { territory_id: string } | null; error: unknown }

  if (!link) return null

  const { data: territory } = await supabase
    .from('territories')
    .select('*')
    .eq('id', link.territory_id)
    .single() as { data: TerritoryRow | null; error: unknown }

  return territory
}

// ── Get today's assigned zone for a team ─────────────────────────────────────
export async function fetchTodayZone(teamId: string, date: string): Promise<DailyZoneRow | null> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_zones')
    .select('*')
    .eq('team_id', teamId)
    .eq('date', date)
    .single() as { data: DailyZoneRow | null; error: unknown }

  return data
}

// ── Get today's EOD submission for a team ────────────────────────────────────
export async function fetchTodayEOD(teamId: string, date: string): Promise<EODEntry | null> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('team_id', teamId)
    .eq('entry_date', date)
    .single() as { data: EODEntry | null; error: unknown }

  return data
}

// ── Get EOD history for a team ────────────────────────────────────────────────
export async function fetchEODHistory(teamId: string): Promise<EODEntry[]> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('team_id', teamId)
    .not('entry_date', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(30)

  return (data ?? []) as EODEntry[]
}

// ── Get all past covered streets for a team (for map display) ─────────────────
export async function fetchPastCoveredStreets(teamId: string): Promise<GeoJSON.FeatureCollection> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('covered_streets, entry_date')
    .eq('team_id', teamId)
    .not('covered_streets', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(14) // last 2 weeks

  const allFeatures: GeoJSON.Feature[] = []
  for (const row of (data ?? []) as { covered_streets: GeoJSON.FeatureCollection | null; entry_date: string }[]) {
    if (row.covered_streets?.features) {
      for (const f of row.covered_streets.features) {
        allFeatures.push({ ...f, properties: { ...f.properties, date: row.entry_date } })
      }
    }
  }

  return { type: 'FeatureCollection', features: allFeatures }
}

// ── Submit EOD ────────────────────────────────────────────────────────────────
export async function submitEOD(data: {
  team_id:          string
  entry_date:       string
  pph:              number
  canvas_hours:     number
  pac_total_amount: number
  pac_count:        number
  pac_average:      number
  recalls_count:    number
  note:             string
  covered_streets:  GeoJSON.FeatureCollection
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entry, error } = await (supabase as any)
    .from('daily_entries')
    .insert({
      team_id:          data.team_id,
      entry_date:       data.entry_date,
      pph:              data.pph,
      canvas_hours:     data.canvas_hours,
      pac_total_amount: data.pac_total_amount,
      pac_count:        data.pac_count,
      pac_average:      data.pac_average,
      recalls_count:    data.recalls_count,
      note:             data.note || null,
      covered_streets:  data.covered_streets,
    })
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !entry) return { error: error?.message ?? 'Failed to submit EOD' }

  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')

  return { id: entry.id }
}

// ── Recent EODs across all teams (for manager performance tab) ────────────────
export async function fetchRecentEODs(limit = 50): Promise<EODWithTeam[]> {
  const supabase = createClient()

  const { data: entries } = await supabase
    .from('daily_entries')
    .select('*')
    .not('entry_date', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(limit)

  const rawEntries = (entries ?? []) as EODEntry[]

  // Resolve team names
  const teamIds = rawEntries.map(e => e.team_id).filter(Boolean) as string[]
  const uniqueTeamIds = teamIds.filter((id, i, arr) => arr.indexOf(id) === i)

  let teamNames = new Map<string, string>()
  if (uniqueTeamIds.length > 0) {
    const { data: teams } = await supabase.from('teams').select('id, name').in('id', uniqueTeamIds)
    for (const t of (teams ?? []) as { id: string; name: string }[]) {
      teamNames.set(t.id, t.name)
    }
  }

  return rawEntries.map(e => ({
    ...e,
    team_name: e.team_id ? (teamNames.get(e.team_id) ?? null) : null,
  }))
}
