import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { fetchNotifications } from '@/lib/supabase/notification-actions'
import NotificationsPageClient from '@/components/ui/NotificationsPageClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default async function NotificationsPage({ params: { locale } }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}`)

  const notifications = await fetchNotifications()

  return (
    <NotificationsPageClient
      initialNotifications={notifications}
      userId={user.id}
      locale={locale}
    />
  )
}
