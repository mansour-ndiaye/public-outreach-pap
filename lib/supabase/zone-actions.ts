'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type DailyZoneRow = {
  id:            string
  team_id:       string
  supervisor_id: string | null
  assigned_by:   string
  date:          string
  streets:       GeoJSON.FeatureCollection
  note:          string | null
  created_at:    string
}

export type DailyZoneWithTeam = DailyZoneRow & {
  team_name:       string
  supervisor_name: string | null
}

export type SupervisorOption = {
  id:        string
  full_name: string | null
  email:     string
}

export type TeamZoneStatus = {
  team_id:        string
  team_name:      string
  manager_name:   string | null
  territory_name: string | null
  // Per-supervisor breakdown
  supervisors:    SupervisorZoneStatus[]
}

export type SupervisorZoneStatus = {
  supervisor_id:        string
  supervisor_name:      string
  supervisor_avatar_url: string | null
  zone_assigned:        boolean
  zone_id:              string | null
  last_eod_date:        string | null
  last_pph:             number | null
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
  const teamIds = Array.from(new Set(rawZones.map(z => z.team_id)))
  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .in('id', teamIds)

  const teamNames = new Map<string, string>()
  for (const t of (teams ?? []) as { id: string; name: string }[]) {
    teamNames.set(t.id, t.name)
  }

  // Resolve supervisor names
  const supervisorIds = rawZones.map(z => z.supervisor_id).filter(Boolean) as string[]
  const uniqueSupIds = Array.from(new Set(supervisorIds))
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

  return rawZones.map(z => ({
    ...z,
    team_name:       teamNames.get(z.team_id) ?? z.team_id,
    supervisor_name: z.supervisor_id ? (supervisorNames.get(z.supervisor_id) ?? null) : null,
  }))
}

// ── Fetch supervisors belonging to a team ─────────────────────────────────────
export async function fetchSupervisorsForTeam(teamId: string): Promise<SupervisorOption[]> {
  const supabase = createClient()

  const { data: members } = await supabase
    .from('team_members')
    .select('user_id')
    .eq('team_id', teamId)

  if (!members || members.length === 0) return []

  const memberIds = (members as { user_id: string }[]).map(m => m.user_id)

  const { data: users } = await supabase
    .from('users')
    .select('id, full_name, email')
    .in('id', memberIds)
    .in('role', ['supervisor'])
    .order('full_name')

  return (users ?? []) as SupervisorOption[]
}

// ── Fetch teams with per-supervisor zone status (for manager Teams tab) ────────
export async function fetchTeamsWithZoneStatus(date: string): Promise<TeamZoneStatus[]> {
  const supabase = createClient()

  const [teamsRes, zonesRes, territoriesRes, membersRes, eodRes] = await Promise.all([
    supabase.from('teams').select('id, name, manager_id').order('name'),
    supabase.from('daily_zones').select('id, team_id, supervisor_id, date').eq('date', date),
    supabase.from('team_territories').select('team_id, territory_id'),
    supabase.from('team_members').select('team_id, user_id'),
    supabase.from('daily_entries')
      .select('supervisor_id, team_id, entry_date, pph')
      .not('entry_date', 'is', null)
      .order('entry_date', { ascending: false }),
  ])

  const teams       = (teamsRes.data ?? [])       as { id: string; name: string; manager_id: string | null }[]
  const zones       = (zonesRes.data ?? [])       as { id: string; team_id: string; supervisor_id: string | null; date: string }[]
  const territories = (territoriesRes.data ?? []) as { team_id: string; territory_id: string }[]
  const members     = (membersRes.data ?? [])     as { team_id: string; user_id: string }[]
  const entries     = (eodRes.data ?? [])         as { supervisor_id: string | null; team_id: string | null; entry_date: string; pph: number }[]

  // Resolve territory names
  const allTerritoryIds = Array.from(new Set(territories.map(t => t.territory_id)))
  const territoryNames  = new Map<string, string>()
  if (allTerritoryIds.length > 0) {
    const { data: terrs } = await supabase.from('territories').select('id, name').in('id', allTerritoryIds)
    for (const tr of (terrs ?? []) as { id: string; name: string }[]) {
      territoryNames.set(tr.id, tr.name)
    }
  }

  // Resolve manager names + all supervisor names + avatars
  const allUserIds = [
    ...teams.map(t => t.manager_id).filter(Boolean) as string[],
    ...members.map(m => m.user_id),
  ]
  const uniqueUserIds = Array.from(new Set(allUserIds))
  const userNames   = new Map<string, string>()
  const userAvatars = new Map<string, string | null>()
  if (uniqueUserIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, full_name, email, role, avatar_url')
      .in('id', uniqueUserIds)
    for (const u of (users ?? []) as { id: string; full_name: string | null; email: string; role: string; avatar_url: string | null }[]) {
      userNames.set(u.id, u.full_name || u.email)
      userAvatars.set(u.id, u.avatar_url ?? null)
    }
  }

  // Build lookup structures
  const territoryByTeam = new Map<string, string>()
  for (const t of territories) {
    if (!territoryByTeam.has(t.team_id)) territoryByTeam.set(t.team_id, t.territory_id)
  }

  // zones by (team_id, supervisor_id)
  const zoneKeyMap = new Map<string, string>()  // key: `${teamId}:${supId}` → zone id
  for (const z of zones) {
    const key = `${z.team_id}:${z.supervisor_id ?? ''}`
    if (!zoneKeyMap.has(key)) zoneKeyMap.set(key, z.id)
  }

  // Last EOD per supervisor
  const lastEodBySup = new Map<string, { date: string; pph: number }>()
  for (const e of entries) {
    const key = e.supervisor_id ?? ''
    if (key && !lastEodBySup.has(key)) {
      lastEodBySup.set(key, { date: e.entry_date, pph: e.pph })
    }
  }

  // Supervisors per team (only role=supervisor from team_members)
  const supervisorsByTeam = new Map<string, string[]>()
  for (const m of members) {
    const arr = supervisorsByTeam.get(m.team_id) ?? []
    arr.push(m.user_id)
    supervisorsByTeam.set(m.team_id, arr)
  }

  return teams.map(team => {
    const territoryId = territoryByTeam.get(team.id)
    const teamSupervisorIds = supervisorsByTeam.get(team.id) ?? []

    const supervisors: SupervisorZoneStatus[] = teamSupervisorIds.map(supId => {
      const key = `${team.id}:${supId}`
      const zoneId = zoneKeyMap.get(key) ?? null
      const lastEod = lastEodBySup.get(supId)
      return {
        supervisor_id:         supId,
        supervisor_name:       userNames.get(supId) ?? supId,
        supervisor_avatar_url: userAvatars.get(supId) ?? null,
        zone_assigned:         zoneId !== null,
        zone_id:               zoneId,
        last_eod_date:         lastEod?.date ?? null,
        last_pph:              lastEod?.pph ?? null,
      }
    })

    return {
      team_id:        team.id,
      team_name:      team.name,
      manager_name:   team.manager_id ? (userNames.get(team.manager_id) ?? null) : null,
      territory_name: territoryId ? (territoryNames.get(territoryId) ?? null) : null,
      supervisors,
    }
  })
}

// ── Create a daily zone (insert, not upsert — multiple zones allowed) ─────────
export async function createDailyZone(data: {
  team_id:       string
  supervisor_id: string | null
  date:          string
  streets:       GeoJSON.FeatureCollection
  note:          string
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()

  const { data: user } = await supabase.auth.getUser()
  if (!user.user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zone, error } = await (supabase as any)
    .from('daily_zones')
    .insert({
      team_id:       data.team_id,
      supervisor_id: data.supervisor_id || null,
      assigned_by:   user.user.id,
      date:          data.date,
      streets:       data.streets,
      note:          data.note || null,
    })
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !zone) return { error: error?.message ?? 'Failed to create zone' }

  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')

  return { id: zone.id }
}

// ── Update a daily zone's streets ─────────────────────────────────────────────
export async function updateDailyZone(
  zoneId: string,
  streets: GeoJSON.FeatureCollection,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('daily_zones')
    .update({ streets })
    .eq('id', zoneId)

  if (error) return { error: error.message }
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/admin/manager')
  revalidatePath('/en/admin/manager')
  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  return {}
}

// ── Delete a daily zone ───────────────────────────────────────────────────────
export async function deleteDailyZone(zoneId: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('daily_zones')
    .delete()
    .eq('id', zoneId)

  if (error) return { error: error.message }
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/admin/manager')
  revalidatePath('/en/admin/manager')
  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  return {}
}

// ── Fetch all supervisors (for swap modal) ────────────────────────────────────
export async function fetchAllSupervisors(): Promise<SupervisorOption[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('users')
    .select('id, full_name, email')
    .eq('role', 'supervisor')
    .order('full_name')
  return (data ?? []) as SupervisorOption[]
}

// ── Swap supervisor on an existing daily zone ─────────────────────────────────
export async function swapDailyZoneSupervisor(
  zoneId:           string,
  newSupervisorId:  string,
  oldSupervisorId:  string | null,
  zoneDate:         string,
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('daily_zones')
    .update({ supervisor_id: newSupervisorId })
    .eq('id', zoneId)

  if (error) return { error: error.message }

  // Resolve names for notifications
  const userIds = [newSupervisorId, ...(oldSupervisorId ? [oldSupervisorId] : [])].filter(Boolean)
  const { data: users } = await supabase.from('users').select('id, full_name, email').in('id', userIds)
  const nameMap = new Map<string, string>()
  for (const u of (users ?? []) as { id: string; full_name: string | null; email: string }[]) {
    nameMap.set(u.id, u.full_name || u.email)
  }
  const { data: sender } = await supabase.from('users').select('full_name, email').eq('id', user.id).single() as { data: { full_name: string | null; email: string } | null }
  const senderName = sender?.full_name || sender?.email || 'Manager'

  const dateLabel = new Date(zoneDate + 'T00:00:00').toLocaleDateString('fr-CA', { day: 'numeric', month: 'long' })
  const notifications: {
    recipient_id: string; sender_id: string; type: string; title: string; message: string; metadata: Record<string, unknown>; read: boolean
  }[] = []

  // Notify new supervisor
  notifications.push({
    recipient_id: newSupervisorId,
    sender_id:    user.id,
    type:         'zone_assigned',
    title:        `Terrain assigné — ${dateLabel}`,
    message:      `${senderName} vous a assigné un terrain pour le ${dateLabel}`,
    metadata:     { zone_id: zoneId, zone_date: zoneDate, sender_name: senderName },
    read:         false,
  })

  // Notify old supervisor if there was one
  if (oldSupervisorId && oldSupervisorId !== newSupervisorId) {
    notifications.push({
      recipient_id: oldSupervisorId,
      sender_id:    user.id,
      type:         'zone_reassigned',
      title:        `Terrain réassigné — ${dateLabel}`,
      message:      `${senderName} a réassigné votre terrain du ${dateLabel} à ${nameMap.get(newSupervisorId) ?? '—'}`,
      metadata:     { zone_id: zoneId, zone_date: zoneDate, sender_name: senderName },
      read:         false,
    })
  }

  if (notifications.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('notifications').insert(notifications)
  }

  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/admin/manager')
  revalidatePath('/en/admin/manager')
  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  return {}
}
