import { DashboardShell } from '@/components/dashboard/DashboardShell'

interface Props {
  params: { locale: string }
}

export default function SupervisorDashboardPage({ params: { locale } }: Props) {
  return <DashboardShell locale={locale} requiredRole="supervisor" />
}
