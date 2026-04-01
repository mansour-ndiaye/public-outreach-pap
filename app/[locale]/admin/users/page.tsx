import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { UsersTable } from '@/components/admin/users/UsersTable'
import type { UserRow } from '@/types'

interface Props {
  params: { locale: string }
}

export default async function AdminUsersPage({ params: { locale: _locale } }: Props) {
  const t = await getTranslations('admin.users')
  const supabase = createClient()

  const { data: users } = await supabase
    .from('users')
    .select('*')
    .order('created_at', { ascending: false })

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

      <UsersTable users={(users ?? []) as UserRow[]} />

    </div>
  )
}
