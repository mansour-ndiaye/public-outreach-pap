import { createClient } from '@/lib/supabase/server'
import { fetchTerritories, fetchTeams } from '@/lib/supabase/territory-actions'
import { fetchTeamsWithDetails } from '@/lib/supabase/team-actions'
import AdminSettings from '@/components/admin/settings/AdminSettings'
import type { UserRow, TerritoryRow } from '@/types'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default async function AdminSettingsPage({ params: { locale } }: Props) {
  const supabase = createClient()

  const [territories, teams, teamsWithDetails, usersResult] = await Promise.all([
    fetchTerritories() as Promise<TerritoryRow[]>,
    fetchTeams(),
    fetchTeamsWithDetails(),
    supabase.from('users').select('*').order('created_at', { ascending: false }),
  ])

  const users = (usersResult.data ?? []) as UserRow[]

  return (
    <div className="p-0 sm:p-2">
      <div className="px-4 sm:px-6 pt-6 pb-4 max-w-4xl mx-auto">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
          {locale !== 'en' ? 'Paramètres' : 'Settings'}
        </h1>
        <p className="font-body text-sm text-slate-500 dark:text-white/45 mt-1">
          {locale !== 'en'
            ? 'Gérez les zones, équipes, utilisateurs et préférences.'
            : 'Manage zones, teams, users and preferences.'}
        </p>
      </div>
      <AdminSettings
        territories={territories}
        teams={teams}
        teamsWithDetails={teamsWithDetails}
        users={users}
        locale={locale}
      />
    </div>
  )
}
