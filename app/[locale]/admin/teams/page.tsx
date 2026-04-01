import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

export default async function AdminTeamsPage() {
  const tNav = await getTranslations('admin.nav')
  const t = await getTranslations('admin.placeholder')

  return (
    <div className="p-6 sm:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold tracking-tight text-brand-navy dark:text-white">
          {tNav('teams')}
        </h1>
      </div>
      <div className="flex flex-col items-center justify-center rounded-2xl py-20
        bg-white dark:bg-white/[0.03]
        border border-slate-100 dark:border-white/[0.06]
        text-center space-y-3">
        <div className="text-3xl mb-2">👥</div>
        <h2 className="font-display font-semibold text-base text-brand-navy dark:text-white">
          {t('coming_soon')}
        </h2>
        <p className="font-body text-sm text-slate-500 dark:text-white/40 max-w-xs leading-relaxed">
          {t('coming_soon_desc')}
        </p>
      </div>
    </div>
  )
}
