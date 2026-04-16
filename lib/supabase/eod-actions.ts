'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TerritoryRow } from '@/types'
import type { DailyZoneRow, DailyZoneWithTeam } from './zone-actions'
import { notifyManagersEODSubmitted } from './notification-actions'

export type RecallEntry = {
  street:      string
  postal_code: string
  numbers:     string[]
}

export type EODEntry = {
  id:               string
  assignment_id:    string | null
  team_id:          string | null
  supervisor_id:    string | null
  entry_date:       string | null
  pac_count:        number
  pac_total_amount: number
  pac_average:      number
  pph:              number
  recalls_count:    number
  recalls:          RecallEntry[] | null
  pfu:              number
  canvas_hours:     number | null
  note:             string | null
  covered_streets:  GeoJSON.FeatureCollection | null
  created_at:       string
}

export type EODWithTeam = EODEntry & {
  team_name:            string | null
  supervisor_name:      string | null
  supervisor_avatar_url: string | null
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

// ── Get ALL zones assigned to a specific supervisor today (multiple allowed) ──
export async function fetchTodayZones(supervisorId: string, date: string): Promise<DailyZoneWithTeam[]> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_zones')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .eq('date', date)
    .order('created_at', { ascending: true })

  const rawZones = (data ?? []) as DailyZoneRow[]

  // Resolve supervisor name
  let supervisorName: string | null = null
  if (supervisorId) {
    const { data: sup } = await supabase
      .from('users')
      .select('full_name, email')
      .eq('id', supervisorId)
      .single() as { data: { full_name: string | null; email: string } | null; error: unknown }
    supervisorName = sup?.full_name || sup?.email || null
  }

  return rawZones.map(z => ({
    ...z,
    team_name: '',
    supervisor_name: supervisorName,
  }))
}

// ── Get all zones for a team today — with supervisor names ────────────────────
export async function fetchTeamZonesToday(teamId: string, date: string): Promise<DailyZoneWithTeam[]> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_zones')
    .select('*')
    .eq('team_id', teamId)
    .eq('date', date)
    .order('created_at', { ascending: true })

  const rawZones = (data ?? []) as DailyZoneRow[]

  // Resolve supervisor names
  const supIds = rawZones.map(z => z.supervisor_id).filter(Boolean) as string[]
  const uniqueSupIds = Array.from(new Set(supIds))
  const supervisorNames = new Map<string, string>()
  if (uniqueSupIds.length > 0) {
    const { data: sups } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', uniqueSupIds)
    for (const s of (sups ?? []) as { id: string; full_name: string | null; email: string }[]) {
      supervisorNames.set(s.id, s.full_name || s.email)
    }
  }

  // Resolve team name
  const { data: team } = await supabase
    .from('teams')
    .select('name')
    .eq('id', teamId)
    .single() as { data: { name: string } | null; error: unknown }
  const teamName = team?.name ?? teamId

  return rawZones.map(z => ({
    ...z,
    team_name:       teamName,
    supervisor_name: z.supervisor_id ? (supervisorNames.get(z.supervisor_id) ?? null) : null,
  }))
}

// ── Get other supervisors' covered streets for the team (last 14 days) ────────
export async function fetchTeamPastCoveredStreets(
  teamId: string,
  excludeSupervisorId: string,
): Promise<GeoJSON.FeatureCollection> {
  const supabase = createClient()

  // Get all member ids in the team
  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)

  const memberIds = ((members ?? []) as { user_id: string }[])
    .map(m => m.user_id)
    .filter(id => id !== excludeSupervisorId)

  if (memberIds.length === 0) return { type: 'FeatureCollection', features: [] }

  const { data: entries } = await supabase
    .from('daily_entries')
    .select('id, covered_streets, supervisor_id, team_id, entry_date, pph, canvas_hours, pac_count, pac_total_amount, pfu, recalls_count, note')
    .in('supervisor_id', memberIds)
    .not('covered_streets', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(30 * memberIds.length)

  return enrichCoveredStreets(supabase, (entries ?? []) as CoveredStreetEntry[])
}

type CoveredStreetEntry = {
  id:              string
  covered_streets: GeoJSON.FeatureCollection | null
  supervisor_id:   string | null
  team_id:         string | null
  entry_date:      string
  pph:             number
  canvas_hours:    number | null
  pac_count:       number
  pac_total_amount: number
  pfu:             number
  recalls_count:   number
  note:            string | null
}

async function enrichCoveredStreets(
  supabase: ReturnType<typeof createClient>,
  entries: CoveredStreetEntry[],
): Promise<GeoJSON.FeatureCollection> {
  const supIds = Array.from(new Set(entries.map(e => e.supervisor_id).filter(Boolean) as string[]))
  const teamIds = Array.from(new Set(entries.map(e => e.team_id).filter(Boolean) as string[]))

  const supNames = new Map<string, string>()
  if (supIds.length > 0) {
    const { data: sups } = await supabase
      .from('users').select('id, full_name, email').in('id', supIds)
    for (const s of (sups ?? []) as { id: string; full_name: string | null; email: string }[]) {
      supNames.set(s.id, s.full_name || s.email)
    }
  }

  const teamNames = new Map<string, string>()
  if (teamIds.length > 0) {
    const { data: teams } = await supabase
      .from('teams').select('id, name').in('id', teamIds)
    for (const tm of (teams ?? []) as { id: string; name: string }[]) {
      teamNames.set(tm.id, tm.name)
    }
  }

  const allFeatures: GeoJSON.Feature[] = []
  for (const row of entries) {
    if (row.covered_streets?.features) {
      const props = {
        supervisor_name:  row.supervisor_id ? (supNames.get(row.supervisor_id) ?? null) : null,
        supervisor_id:    row.supervisor_id,
        team_name:        row.team_id ? (teamNames.get(row.team_id) ?? null) : null,
        entry_date:       row.entry_date,
        pph:              row.pph,
        canvas_hours:     row.canvas_hours,
        pac_count:        row.pac_count,
        pac_total_amount: row.pac_total_amount,
        pfu:              row.pfu,
        recalls_count:    row.recalls_count,
        note:             row.note,
        streets_count:    row.covered_streets.features.length,
        entry_id:         row.id,
      }
      for (let i = 0; i < row.covered_streets.features.length; i++) {
        const f = row.covered_streets.features[i]
        allFeatures.push({
          ...f,
          properties: { ...f.properties, ...props, feature_index: i },
        })
      }
    }
  }

  return { type: 'FeatureCollection', features: allFeatures }
}

// ── Get ALL covered streets (terrain barré) across all teams/supervisors ──────
export async function fetchAllCoveredStreets(): Promise<GeoJSON.FeatureCollection> {
  const supabase = createClient()

  const { data: entries } = await supabase
    .from('daily_entries')
    .select('id, covered_streets, supervisor_id, team_id, entry_date, pph, canvas_hours, pac_count, pac_total_amount, pfu, recalls_count, note')
    .not('covered_streets', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(300)

  return enrichCoveredStreets(supabase, (entries ?? []) as CoveredStreetEntry[])
}

// ── Get today's EOD submission for a supervisor ───────────────────────────────
export async function fetchTodayEOD(supervisorId: string, date: string): Promise<EODEntry | null> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .eq('entry_date', date)
    .single() as { data: EODEntry | null; error: unknown }

  return data
}

// ── Get EOD history for a supervisor ─────────────────────────────────────────
export async function fetchEODHistory(supervisorId: string): Promise<EODEntry[]> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .not('entry_date', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(30)

  return (data ?? []) as EODEntry[]
}

// ── Get all past covered streets for a supervisor (for map display) ───────────
export async function fetchPastCoveredStreets(supervisorId: string): Promise<GeoJSON.FeatureCollection> {
  const supabase = createClient()

  const { data } = await supabase
    .from('daily_entries')
    .select('id, covered_streets, supervisor_id, team_id, entry_date, pph, canvas_hours, pac_count, pac_total_amount, pfu, recalls_count, note')
    .eq('supervisor_id', supervisorId)
    .not('covered_streets', 'is', null)
    .order('entry_date', { ascending: false })
    .limit(30)

  return enrichCoveredStreets(supabase, (data ?? []) as CoveredStreetEntry[])
}

// ── Submit EOD (one per supervisor per day) ───────────────────────────────────
export async function submitEOD(data: {
  team_id:          string
  supervisor_id:    string
  entry_date:       string
  pph:              number
  canvas_hours:     number
  pac_total_amount: number
  pac_count:        number
  pac_average:      number
  recalls:          RecallEntry[]
  pfu:              number
  note:             string
  covered_streets:  GeoJSON.FeatureCollection
  // Optional — used for notifications
  supervisorName?:  string
  teamName?:        string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()

  // Stamp each feature with a stable feature_id for individual deletion support
  const featuresWithIds = data.covered_streets.features.map(f => ({
    ...f,
    properties: {
      ...f.properties,
      feature_id: crypto.randomUUID(),
    },
  }))
  const coveredStreetsWithIds: GeoJSON.FeatureCollection = {
    ...data.covered_streets,
    features: featuresWithIds,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entry, error } = await (supabase as any)
    .from('daily_entries')
    .insert({
      team_id:          data.team_id,
      supervisor_id:    data.supervisor_id,
      entry_date:       data.entry_date,
      pph:              data.pph,
      canvas_hours:     data.canvas_hours,
      pac_total_amount: data.pac_total_amount,
      pac_count:        data.pac_count,
      pac_average:      data.pac_average,
      recalls_count:    data.recalls.length,
      recalls:          data.recalls,
      pfu:              data.pfu,
      note:             data.note || null,
      covered_streets:  coveredStreetsWithIds,
    })
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !entry) return { error: error?.message ?? 'Failed to submit EOD' }

  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')

  // Fire-and-forget: notify all admins/managers
  notifyManagersEODSubmitted({
    senderId:      data.supervisor_id,
    teamId:        data.team_id,
    teamName:      data.teamName ?? '',
    pph:           data.pph,
    entryId:       entry.id,
    entryDate:     data.entry_date,
    supervisorName: data.supervisorName,
  }).catch(() => { /* non-critical */ })

  return { id: entry.id }
}

// ── Delete a single terrain barré line from an EOD entry ─────────────────────
export async function deleteStreetFeature(
  entryId:      string,
  featureIndex: number,
): Promise<{ error?: string }> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: fetchErr } = await (supabase as any)
    .from('daily_entries')
    .select('covered_streets')
    .eq('id', entryId)
    .single() as { data: { covered_streets: GeoJSON.FeatureCollection | null } | null; error: { message: string } | null }

  if (fetchErr || !data) return { error: fetchErr?.message ?? 'Entry not found' }

  const fc = data.covered_streets
  if (!fc?.features) return { error: 'No features found' }

  const newFeatures = fc.features.filter((_, i) => i !== featureIndex)
  const newFC: GeoJSON.FeatureCollection = { ...fc, features: newFeatures }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('daily_entries')
    .update({ covered_streets: newFC })
    .eq('id', entryId)

  if (updateErr) return { error: updateErr.message }

  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/admin/manager')
  revalidatePath('/en/admin/manager')
  revalidatePath('/fr/admin/territories')
  revalidatePath('/en/admin/territories')

  return {}
}

// ── PPH leaderboard across all supervisors ────────────────────────────────────
export type LeaderboardEntry = {
  supervisor_id:   string
  supervisor_name: string
  avatar_url:      string | null
  team_name:       string | null
  avg_pph:         number
  canvas_hours:    number
}

export async function fetchPPHLeaderboard(period: 'week' | 'all' = 'week'): Promise<LeaderboardEntry[]> {
  const supabase = createClient()

  let query = supabase
    .from('daily_entries')
    .select('supervisor_id, pph, canvas_hours, team_id, entry_date')
    .not('supervisor_id', 'is', null)
    .not('entry_date', 'is', null)

  if (period === 'week') {
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    query = query.gte('entry_date', weekAgo.toISOString().split('T')[0])
  }

  const { data: entries } = await query
  if (!entries || entries.length === 0) return []

  const raw = entries as { supervisor_id: string; pph: number; canvas_hours: number | null; team_id: string | null; entry_date: string }[]

  // Aggregate per supervisor
  const agg = new Map<string, { sum: number; count: number; hours: number; team_id: string | null }>()
  for (const e of raw) {
    const key = e.supervisor_id
    const existing = agg.get(key) ?? { sum: 0, count: 0, hours: 0, team_id: e.team_id }
    agg.set(key, {
      sum:     existing.sum + (e.pph ?? 0),
      count:   existing.count + 1,
      hours:   existing.hours + (e.canvas_hours ?? 0),
      team_id: existing.team_id ?? e.team_id,
    })
  }

  // Resolve names
  const supIds  = Array.from(agg.keys())
  const teamIds = Array.from(new Set(Array.from(agg.values()).map(v => v.team_id).filter(Boolean))) as string[]

  const [supsRes, teamsRes] = await Promise.all([
    supabase.from('users').select('id, full_name, email, avatar_url').in('id', supIds),
    teamIds.length > 0 ? supabase.from('teams').select('id, name').in('id', teamIds) : Promise.resolve({ data: [] }),
  ])

  const supMap  = new Map<string, { name: string; avatar_url: string | null }>()
  for (const s of (supsRes.data ?? []) as { id: string; full_name: string | null; email: string; avatar_url: string | null }[]) {
    supMap.set(s.id, { name: s.full_name || s.email, avatar_url: s.avatar_url ?? null })
  }
  const teamMap = new Map<string, string>()
  for (const t of (teamsRes.data ?? []) as { id: string; name: string }[]) {
    teamMap.set(t.id, t.name)
  }

  const results: LeaderboardEntry[] = Array.from(agg.entries()).map(([id, v]) => ({
    supervisor_id:   id,
    supervisor_name: supMap.get(id)?.name ?? id,
    avatar_url:      supMap.get(id)?.avatar_url ?? null,
    team_name:       v.team_id ? (teamMap.get(v.team_id) ?? null) : null,
    avg_pph:         v.count > 0 ? v.sum / v.count : 0,
    canvas_hours:    v.hours,
  }))

  return results.sort((a, b) => b.avg_pph - a.avg_pph)
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
  const uniqueTeamIds = Array.from(new Set(teamIds))
  const teamNames = new Map<string, string>()
  if (uniqueTeamIds.length > 0) {
    const { data: teams } = await supabase.from('teams').select('id, name').in('id', uniqueTeamIds)
    for (const t of (teams ?? []) as { id: string; name: string }[]) {
      teamNames.set(t.id, t.name)
    }
  }

  // Resolve supervisor names + avatars
  const supIds = rawEntries.map(e => e.supervisor_id).filter(Boolean) as string[]
  const uniqueSupIds = Array.from(new Set(supIds))
  const supervisorNames   = new Map<string, string>()
  const supervisorAvatars = new Map<string, string | null>()
  if (uniqueSupIds.length > 0) {
    const { data: sups } = await supabase.from('users').select('id, full_name, email, avatar_url').in('id', uniqueSupIds)
    for (const s of (sups ?? []) as { id: string; full_name: string | null; email: string; avatar_url: string | null }[]) {
      supervisorNames.set(s.id, s.full_name || s.email)
      supervisorAvatars.set(s.id, s.avatar_url ?? null)
    }
  }

  return rawEntries.map(e => ({
    ...e,
    team_name:             e.team_id ? (teamNames.get(e.team_id) ?? null) : null,
    supervisor_name:       e.supervisor_id ? (supervisorNames.get(e.supervisor_id) ?? null) : null,
    supervisor_avatar_url: e.supervisor_id ? (supervisorAvatars.get(e.supervisor_id) ?? null) : null,
  }))
}
