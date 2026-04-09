'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { updateAvatarUrl } from '@/lib/supabase/user-actions'
import { cn } from '@/lib/utils'

interface AvatarButtonProps {
  userId:    string
  name:      string
  avatarUrl?: string | null
  size?:     'xs' | 'sm' | 'md' | 'lg'
  locale?:   string
  className?: string
  /** Background color class when no photo (defaults to bg-brand-navy) */
  bgClass?:  string
}

const SIZE_MAP = {
  xs: 'w-6 h-6 text-[9px]',
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-12 h-12 text-base',
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

export function AvatarButton({
  userId, name, avatarUrl, size = 'sm', locale, className, bgClass = 'bg-brand-navy',
}: AvatarButtonProps) {
  const router   = useRouter()
  const fileRef  = useRef<HTMLInputElement>(null)
  const [open,      setOpen]      = useState(false)
  const [uploading, setUploading] = useState(false)
  const [localUrl,  setLocalUrl]  = useState<string | null>(null)

  const displayUrl = localUrl ?? avatarUrl ?? null
  const label      = initials(name)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return // 2 MB max

    setUploading(true)
    const supabase = createClient()

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(userId, file, { upsert: true, contentType: file.type })

    if (!uploadError) {
      const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(userId)
      const busted = `${publicUrl}?t=${Date.now()}`
      setLocalUrl(busted)
      await updateAvatarUrl(userId, publicUrl)
      router.refresh()
    }

    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleRemove = async () => {
    setOpen(false)
    setUploading(true)
    const supabase = createClient()
    await supabase.storage.from('avatars').remove([userId])
    await updateAvatarUrl(userId, null)
    setLocalUrl(null)
    setUploading(false)
    router.refresh()
  }

  return (
    <div className={cn('relative shrink-0', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={uploading}
        title={locale !== 'en' ? 'Changer la photo' : 'Change photo'}
        className={cn(
          'rounded-full overflow-hidden flex items-center justify-center select-none',
          !displayUrl && bgClass,
          SIZE_MAP[size],
        )}
      >
        {uploading ? (
          <svg className="animate-spin w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        ) : displayUrl ? (
          <img src={displayUrl} alt={name} className="w-full h-full object-cover" />
        ) : (
          <span className="font-display font-bold text-white">{label}</span>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {open && !uploading && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div className={cn(
            'absolute right-0 top-full mt-1.5 z-[70] py-1 min-w-[175px]',
            'bg-white dark:bg-[#12163a] rounded-xl shadow-xl',
            'border border-slate-200/80 dark:border-white/10',
          )}>
            <button
              type="button"
              onClick={() => { setOpen(false); fileRef.current?.click() }}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 font-body text-sm text-slate-700 dark:text-white/80 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/>
              </svg>
              {locale !== 'en' ? 'Changer la photo' : 'Change photo'}
            </button>
            {displayUrl && (
              <button
                type="button"
                onClick={handleRemove}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 font-body text-sm text-brand-red hover:bg-brand-red/5 transition-colors"
              >
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <polyline strokeLinecap="round" strokeLinejoin="round" points="3 6 5 6 21 6"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 6l-1 14H6L5 6"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 11v6M14 11v6M9 6V4h6v2"/>
                </svg>
                {locale !== 'en' ? 'Supprimer la photo' : 'Remove photo'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Static avatar display (no upload, just show photo or initials) ─────────────
interface AvatarDisplayProps {
  name:      string
  avatarUrl?: string | null
  size?:     'xs' | 'sm' | 'md' | 'lg'
  className?: string
  bgClass?:  string
}

export function AvatarDisplay({ name, avatarUrl, size = 'sm', className, bgClass = 'bg-brand-navy/10 dark:bg-white/10' }: AvatarDisplayProps) {
  const label = initials(name)
  return (
    <div className={cn(
      'rounded-full overflow-hidden flex items-center justify-center select-none shrink-0',
      !avatarUrl && bgClass,
      SIZE_MAP[size],
      className,
    )}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="font-display font-bold text-brand-navy dark:text-white text-[inherit]">{label}</span>
      )}
    </div>
  )
}
