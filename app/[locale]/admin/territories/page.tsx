import nextDynamic from 'next/dynamic'
import { fetchTerritories, fetchTeams } from '@/lib/supabase/territory-actions'
import { fetchAllCoveredStreets } from '@/lib/supabase/eod-actions'
import type { TerritoryRow, TeamRow } from '@/types'

export const dynamic = 'force-dynamic'

const TerritoriesMap = nextDynamic(
  () => import('@/components/admin/territories/TerritoriesMap').then(m => m.TerritoriesMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center bg-slate-100 dark:bg-[#0a0d28]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-brand-teal border-t-transparent rounded-full animate-spin" />
          <p className="font-body text-sm text-slate-400 dark:text-white/30">Chargement de la carte…</p>
        </div>
      </div>
    ),
  },
)

export default async function AdminTerritoriesPage({ params: { locale } }: { params: { locale: string } }) {
  const [territories, teams, allCoveredStreets] = await Promise.all([
    fetchTerritories() as Promise<TerritoryRow[]>,
    fetchTeams()       as Promise<TeamRow[]>,
    fetchAllCoveredStreets(),
  ])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <TerritoriesMap territories={territories} teams={teams} allCoveredStreets={allCoveredStreets} locale={locale} />
    </div>
  )
}
