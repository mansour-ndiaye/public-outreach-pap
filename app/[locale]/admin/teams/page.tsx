import { getTranslations } from 'next-intl/server'
import { fetchTeamsWithDetails, fetchManagerUsers, fetchFieldUsers } from '@/lib/supabase/team-actions'
import { fetchTerritories } from '@/lib/supabase/territory-actions'
import { TeamsTable } from '@/components/admin/teams/TeamsTable'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default async function AdminTeamsPage({ params: { locale: _locale } }: Props) {
  const t = await getTranslations('admin.teams')

  const [teams, managers, fieldUsers, territories] = await Promise.all([
    fetchTeamsWithDetails(),
    fetchManagerUsers(),
    fetchFieldUsers(),
    fetchTerritories(),
  ])

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">

      {/* Page heading */}
      <div className="mb-7">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
          {t('title')}
        </h1>
        <p className="font-body text-sm text-slate-500 dark:text-white/45 mt-1">
          {t('subtitle')}
        </p>
      </div>

      <TeamsTable
        teams={teams}
        managers={managers}
        fieldUsers={fieldUsers}
        territories={territories}
      />

    </div>
  )
}
