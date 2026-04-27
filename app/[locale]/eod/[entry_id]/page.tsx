import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchEodById } from '@/lib/supabase/eod-actions'
import { fetchEvalByEodId } from '@/lib/supabase/eval-actions'
import EodDetailView from '@/components/ui/EodDetailView'

interface Props {
  params: { locale: string; entry_id: string }
}

export default async function EodDetailPage({ params: { locale, entry_id } }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/${locale}/login`)

  const [eod, eval_] = await Promise.all([
    fetchEodById(entry_id),
    fetchEvalByEodId(entry_id),
  ])

  if (!eod) redirect(`/${locale}/manager/dashboard`)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0a0e27] py-6">
      <EodDetailView eod={eod} eval_={eval_} locale={locale} />
    </div>
  )
}
