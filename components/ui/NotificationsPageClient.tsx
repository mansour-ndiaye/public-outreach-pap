'use client'

import { useState, useEffect, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  fetchNotifications,
  markNotificationsRead,
  markAllRead,
} from '@/lib/supabase/notification-actions'
import type { NotificationWithSender } from '@/lib/supabase/notification-actions'
import { cn } from '@/lib/utils'

function formatRelativeTime(dateStr: string, locale?: string) {
  try {
    const date = new Date(dateStr)
    const now  = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const isFr = locale !== 'en'
    const isToday = date.toDateString() === now.toDateString()
    if (diffMins < 1)  return isFr ? "À l'instant" : 'Just now'
    if (diffMins < 60) return isFr ? `Il y a ${diffMins} min` : `${diffMins}m ago`
    const diffHrs = Math.floor(diffMins / 60)
    if (isToday && diffHrs < 24) {
      const time = date.toLocaleTimeString(isFr ? 'fr-CA' : 'en-CA', { hour: '2-digit', minute: '2-digit' })
      return isFr ? `Aujourd'hui à ${time}` : `Today at ${time}`
    }
    return date.toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}

function AvatarPlaceholder({ name }: { name: string }) {
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="w-10 h-10 rounded-full bg-brand-teal flex items-center justify-center shrink-0">
      <span className="font-body text-sm font-bold text-white">{initials}</span>
    </div>
  )
}

interface Props {
  initialNotifications: NotificationWithSender[]
  userId: string
  locale: string
}

export default function NotificationsPageClient({ initialNotifications, userId, locale }: Props) {
  const isFr = locale !== 'en'
  const router = useRouter()
  const [notifications, setNotifications] = useState<NotificationWithSender[]>(initialNotifications)
  const [, startTransition] = useTransition()

  const unreadCount = notifications.filter(n => !n.read).length

  // Mark all as read on page load
  useEffect(() => {
    if (notifications.some(n => !n.read)) {
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      startTransition(() => { markAllRead() })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`notifications-page:${userId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`,
      }, () => {
        fetchNotifications().then(setNotifications)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const handleNotificationClick = useCallback((id: string) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    startTransition(() => { markNotificationsRead([id]) })
  }, [])

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-slate-600 dark:text-white/60"
            aria-label={isFr ? 'Retour' : 'Back'}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="font-display text-xl font-bold text-brand-navy dark:text-white">
              {isFr ? 'Notifications' : 'Notifications'}
            </h1>
            {unreadCount > 0 && (
              <p className="font-body text-xs text-slate-500 dark:text-white/40 mt-0.5">
                {unreadCount} {isFr ? 'non lue(s)' : 'unread'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Notification list */}
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'bg-white dark:bg-white/[0.02]',
        'border border-slate-200/80 dark:border-white/[0.07]',
      )}>
        {notifications.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <svg className="w-10 h-10 mx-auto mb-3 text-slate-300 dark:text-white/20" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            <p className="font-body text-sm text-slate-400 dark:text-white/30">
              {isFr ? 'Aucune notification' : 'No notifications'}
            </p>
          </div>
        ) : (
          notifications.map(n => {
            const meta = n.metadata as Record<string, unknown>
            const pph = typeof meta.pph === 'number' ? meta.pph : null
            const teamName = typeof meta.team_name === 'string' ? meta.team_name : null
            const entryId = typeof meta.entry_id === 'string' ? meta.entry_id : null
            const senderName = n.sender_name ?? (typeof meta.supervisor_name === 'string' ? meta.supervisor_name : null)
            const avatarUrl = n.sender_avatar_url ?? (typeof meta.sender_avatar_url === 'string' ? meta.sender_avatar_url : null)

            return (
              <div
                key={n.id}
                onClick={() => handleNotificationClick(n.id)}
                className={cn(
                  'px-4 py-4 cursor-pointer transition-colors',
                  'hover:bg-slate-50 dark:hover:bg-white/[0.04]',
                  'border-b border-slate-100 dark:border-white/[0.04] last:border-0',
                  !n.read && 'border-l-[3px] border-l-brand-navy dark:border-l-brand-teal',
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={senderName ?? ''} className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <AvatarPlaceholder name={senderName ?? 'S'} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-body text-sm font-semibold text-brand-navy dark:text-white truncate">
                        {senderName}
                      </p>
                      {!n.read && (
                        <span className="shrink-0 w-2 h-2 rounded-full bg-brand-teal" />
                      )}
                    </div>

                    {teamName && (
                      <p className="font-body text-xs text-slate-400 dark:text-white/40 truncate">{teamName}</p>
                    )}

                    <p className="font-body text-xs text-slate-500 dark:text-white/50">
                      {isFr ? 'A soumis son rapport EOD' : 'Submitted EOD report'}
                    </p>

                    <div className="flex items-center justify-between pt-0.5">
                      <div className="flex items-center gap-3">
                        {pph != null && (
                          <span className="font-body text-xs font-semibold text-brand-teal">
                            PPH {Number(pph).toFixed(2)}
                          </span>
                        )}
                        <span className="font-body text-[11px] text-slate-400 dark:text-white/30">
                          {formatRelativeTime(n.created_at, locale)}
                        </span>
                      </div>

                      {entryId && (
                        <a
                          href={`/${locale}/manager/dashboard`}
                          onClick={e => e.stopPropagation()}
                          className="font-body text-[11px] font-semibold text-brand-navy dark:text-brand-teal hover:underline"
                        >
                          {isFr ? 'Voir le rapport' : 'View report'}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
