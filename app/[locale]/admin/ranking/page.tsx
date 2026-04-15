import { PPHLeaderboard } from '@/components/ui/PPHLeaderboard'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default function AdminRankingPage({ params: { locale } }: Props) {
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PPHLeaderboard locale={locale} />
    </div>
  )
}
