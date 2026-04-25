import { fetchAllEvals } from '@/lib/supabase/eval-actions'
import EvalsManagerView from '@/components/manager/EvalsManagerView'

export const dynamic = 'force-dynamic'

interface Props {
  params: { locale: string }
}

export default async function AdminEvalsPage({ params: { locale } }: Props) {
  const allEvals = await fetchAllEvals()

  return (
    <div className="h-full overflow-y-auto">
      <EvalsManagerView allEvals={allEvals} locale={locale} />
    </div>
  )
}
