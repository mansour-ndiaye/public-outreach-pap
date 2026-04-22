import nextDynamic from 'next/dynamic'
import {
  fetchSupervisorTeam,
  fetchSupervisorTerritory,
  fetchTodayZones,
  fetchTeamZonesToday,
  fetchTodayEODs,
  fetchEODHistory,
  fetchPastCoveredStreets,
  fetchTeamPastCoveredStreets,
} from '@/lib/supabase/eod-actions'
import { getCurrentUser } from '@/lib/supabase/actions'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// Team color palette (must match ManagerDashboard)
const TEAM_COLORS = [
  '#E8174B', '#00B5A3', '#FF8C00', '#8B5CF6',
  '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
]

// Load supervisor dashboard without SSR (contains Mapbox map)
const SupervisorDashboard = nextDynamic(
  () => import('@/components/supervisor/SupervisorDashboard'),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-brand-teal border-t-transparent animate-spin" />
          <span className="font-body text-sm text-slate-500 dark:text-white/40">Chargement...</span>
        </div>
      </div>
    ),
  }
)

interface Props {
  params: { locale: string }
}

async function fetchSupervisorName(userId: string): Promise<string> {
  const supabase = createClient()
  const { data } = await supabase
    .from('users')
    .select('full_name, email')
    .eq('id', userId)
    .single() as { data: { full_name: string | null; email: string } | null; error: unknown }
  return data?.full_name || data?.email || ''
}

async function fetchAllTeams(): Promise<{ id: string; name: string }[]> {
  const supabase = createClient()
  const { data } = await supabase.from('teams').select('id, name').order('name')
  return (data ?? []) as { id: string; name: string }[]
}

export default async function SupervisorDashboardPage({ params: { locale } }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}`)

  // Get supervisor's team
  const team = await fetchSupervisorTeam()

  if (!team) {
    // Supervisor not assigned to any team — show friendly message
    return (
      <div className="max-w-lg mx-auto px-4 py-16 text-center">
        <div className="text-4xl mb-4">🏷️</div>
        <h2 className="font-display text-xl font-bold text-brand-navy dark:text-white mb-2">
          Aucune équipe assignée
        </h2>
        <p className="font-body text-sm text-slate-500 dark:text-white/50">
          Vous n&apos;êtes pas encore assigné(e) à une équipe. Contactez votre administrateur.
        </p>
      </div>
    )
  }

  const [
    territory, todayZones, teamZones, todayEODs,
    eodHistory, pastStreets, teamPastStreets, supervisorName, allTeams,
  ] = await Promise.all([
    fetchSupervisorTerritory(team.teamId),
    fetchTodayZones(user.id, today),
    fetchTeamZonesToday(team.teamId, today),
    fetchTodayEODs(user.id, today),
    fetchEODHistory(user.id),
    fetchPastCoveredStreets(user.id),
    fetchTeamPastCoveredStreets(team.teamId, user.id),
    fetchSupervisorName(user.id),
    fetchAllTeams(),
  ])

  // Assign a stable team color based on sorted team list
  const sortedTeams = allTeams.sort((a, b) => a.name.localeCompare(b.name))
  const teamIdx = sortedTeams.findIndex(t => t.id === team.teamId)
  const teamColor = TEAM_COLORS[teamIdx % TEAM_COLORS.length] ?? '#94a3b8'

  return (
    <SupervisorDashboard
      teamId={team.teamId}
      teamName={team.teamName}
      supervisorId={user.id}
      supervisorName={supervisorName}
      territory={territory}
      todayZones={todayZones}
      teamZones={teamZones}
      todayEODs={todayEODs}
      eodHistory={eodHistory}
      pastStreets={pastStreets}
      teamPastStreets={teamPastStreets}
      todayDate={today}
      teamColor={teamColor}
      locale={locale}
    />
  )
}
