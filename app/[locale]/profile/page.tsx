import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/actions'
import ProfilePageClient from '@/components/ui/ProfilePageClient'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default async function ProfilePage({ params: { locale } }: Props) {
  const user = await getCurrentUser()
  if (!user) redirect(`/${locale}/login`)

  return <ProfilePageClient user={user} locale={locale} />
}
