import nextDynamic from 'next/dynamic'
import {
  fetchSupervisorTeam,
  fetchSupervisorTerritory,
  fetchTodayZone,
  fetchTodayEOD,
  fetchEODHistory,
  fetchPastCoveredStreets,
} from '@/lib/supabase/eod-actions'
import { getCurrentUser } from '@/lib/supabase/actions'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

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

  const [territory, todayZone, todayEOD, eodHistory, pastStreets] = await Promise.all([
    fetchSupervisorTerritory(team.teamId),
    fetchTodayZone(team.teamId, today),
    fetchTodayEOD(team.teamId, today),
    fetchEODHistory(team.teamId),
    fetchPastCoveredStreets(team.teamId),
  ])

  return (
    <SupervisorDashboard
      teamId={team.teamId}
      teamName={team.teamName}
      territory={territory}
      todayZone={todayZone}
      todayEOD={todayEOD}
      eodHistory={eodHistory}
      pastStreets={pastStreets}
      todayDate={today}
    />
  )
}
