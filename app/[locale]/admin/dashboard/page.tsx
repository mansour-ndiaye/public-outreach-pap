import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { StatsCard } from '@/components/admin/StatsCard'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

// Icons for stat cards
function IconUsers() {
  return (
    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function IconMap() {
  return (
    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  )
}
function IconTeams() {
  return (
    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function IconCalendar() {
  return (
    <svg className="w-6 h-6" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  )
}

async function fetchStats() {
  const supabase = createClient()
  const today = new Date().toISOString().split('T')[0]

  const [
    { count: userCount },
    { count: territoryCount },
    { count: teamCount },
    { count: assignmentCount },
  ] = await Promise.all([
    supabase.from('users').select('*', { count: 'exact', head: true }),
    supabase.from('territories').select('*', { count: 'exact', head: true }),
    supabase.from('teams').select('*', { count: 'exact', head: true }),
    supabase.from('assignments').select('*', { count: 'exact', head: true }).eq('date', today),
  ])

  return {
    users:      userCount      ?? 0,
    territories: territoryCount ?? 0,
    teams:      teamCount      ?? 0,
    assignmentsToday: assignmentCount ?? 0,
  }
}

export default async function AdminDashboardPage({ params: { locale } }: Props) {
  const t = await getTranslations('admin.dashboard')
  const stats = await fetchStats()

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">

      {/* Page heading */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
          {t('title')}
        </h1>
        <p className="font-body text-sm text-slate-500 dark:text-white/45 mt-1">
          {t('subtitle')}
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatsCard
          label={t('stats.users')}
          value={stats.users}
          icon={<IconUsers />}
          accent="navy"
        />
        <StatsCard
          label={t('stats.territories')}
          value={stats.territories}
          icon={<IconMap />}
          accent="teal"
        />
        <StatsCard
          label={t('stats.teams')}
          value={stats.teams}
          icon={<IconTeams />}
          accent="red"
        />
        <StatsCard
          label={t('stats.assignments_today')}
          value={stats.assignmentsToday}
          icon={<IconCalendar />}
          accent="slate"
        />
      </div>

    </div>
  )
}
