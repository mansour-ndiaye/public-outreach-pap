import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default function AdminIndexPage({ params: { locale } }: Props) {
  redirect(`/${locale}/admin/dashboard`)
}
