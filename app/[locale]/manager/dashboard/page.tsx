import { DashboardShell } from '@/components/dashboard/DashboardShell'

interface Props {
  params: { locale: string }
}

export default function ManagerDashboardPage({ params: { locale } }: Props) {
  return <DashboardShell locale={locale} requiredRole="territory_manager" />
}
