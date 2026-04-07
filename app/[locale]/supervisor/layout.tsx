import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/actions'
import { SupervisorShell } from '@/components/supervisor/SupervisorShell'

export const dynamic = 'force-dynamic'

interface Props {
  children: React.ReactNode
  params: { locale: string }
}

export default async function SupervisorLayout({ children, params: { locale } }: Props) {
  const user = await getCurrentUser()

  if (!user) redirect(`/${locale}`)

  // Allow admin and supervisor
  if (user.role !== 'supervisor' && user.role !== 'admin') {
    const routes: Record<string, string> = {
      territory_manager: 'manager',
      field_team:        'field',
    }
    redirect(`/${locale}/${routes[user.role] ?? 'field'}/dashboard`)
  }

  return (
    <SupervisorShell user={user} locale={locale}>
      {children}
    </SupervisorShell>
  )
}
