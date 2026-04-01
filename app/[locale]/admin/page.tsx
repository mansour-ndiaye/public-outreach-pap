import { redirect } from 'next/navigation'

interface Props {
  params: { locale: string }
}

export default function AdminIndexPage({ params: { locale } }: Props) {
  redirect(`/${locale}/admin/dashboard`)
}
