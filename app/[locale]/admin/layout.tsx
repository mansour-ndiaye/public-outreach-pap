import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/actions'
import { AdminShell } from '@/components/admin/AdminShell'

interface Props {
  children: React.ReactNode
  params: { locale: string }
}

export default async function AdminLayout({ children, params: { locale } }: Props) {
  const user = await getCurrentUser()

  if (!user) redirect(`/${locale}`)
  if (user.role !== 'admin') {
    // Redirect to the correct dashboard for their role
    const routes: Record<string, string> = {
      territory_manager: 'manager',
      supervisor:        'supervisor',
      field_team:        'field',
    }
    redirect(`/${locale}/${routes[user.role] ?? 'field'}/dashboard`)
  }

  return (
    <AdminShell user={user} locale={locale}>
      {children}
    </AdminShell>
  )
}
