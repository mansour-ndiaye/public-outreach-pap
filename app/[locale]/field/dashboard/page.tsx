import { DashboardShell } from '@/components/dashboard/DashboardShell'

interface Props {
  params: { locale: string }
}

export default function FieldDashboardPage({ params: { locale } }: Props) {
  return <DashboardShell locale={locale} requiredRole="field_team" />
}
