import { fetchTerritories } from '@/lib/supabase/territory-actions'
import { fetchDailyZones, fetchTeamsWithZoneStatus } from '@/lib/supabase/zone-actions'
import { fetchRecentEODs, fetchAllCoveredStreets } from '@/lib/supabase/eod-actions'
import { createClient } from '@/lib/supabase/server'
import ManagerDashboard from '@/components/manager/ManagerDashboard'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

async function fetchTeams() {
  const supabase = createClient()
  const { data } = await supabase.from('teams').select('id, name').order('name')
  return (data ?? []) as { id: string; name: string }[]
}

export default async function AdminManagerPage({ params: { locale } }: Props) {
  const today = new Date().toISOString().split('T')[0]

  const [territories, teams, zones, zoneStatuses, recentEODs, allCoveredStreets] = await Promise.all([
    fetchTerritories(),
    fetchTeams(),
    fetchDailyZones(),
    fetchTeamsWithZoneStatus(today),
    fetchRecentEODs(100),
    fetchAllCoveredStreets(),
  ])

  return (
    <div className="h-full">
      <ManagerDashboard
        territories={territories}
        teams={teams}
        zones={zones}
        zoneStatuses={zoneStatuses}
        recentEODs={recentEODs}
        allCoveredStreets={allCoveredStreets}
        todayDate={today}
        locale={locale}
        isAdmin
      />
    </div>
  )
}
