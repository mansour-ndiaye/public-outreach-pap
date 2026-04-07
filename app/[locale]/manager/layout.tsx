import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/actions'
import { ManagerShell } from '@/components/manager/ManagerShell'

export const dynamic = 'force-dynamic'

interface Props {
  children: React.ReactNode
  params: { locale: string }
}

export default async function ManagerLayout({ children, params: { locale } }: Props) {
  const user = await getCurrentUser()

  if (!user) redirect(`/${locale}`)

  // Allow admin (Boris) and territory_manager (Alicia)
  if (user.role !== 'territory_manager' && user.role !== 'admin') {
    const routes: Record<string, string> = {
      supervisor: 'supervisor',
      field_team: 'field',
    }
    redirect(`/${locale}/${routes[user.role] ?? 'field'}/dashboard`)
  }

  return (
    <ManagerShell user={user} locale={locale}>
      {children}
    </ManagerShell>
  )
}
