'use server'

import { createClient } from '@/lib/supabase/server'

export type NotificationRow = {
  id:           string
  recipient_id: string
  sender_id:    string | null
  type:         string
  title:        string
  message:      string
  metadata:     Record<string, unknown>
  read:         boolean
  created_at:   string
}

export type NotificationWithSender = NotificationRow & {
  sender_name:       string | null
  sender_avatar_url: string | null
}

// ── Fetch all notifications for the current user ──────────────────────────────
export async function fetchNotifications(): Promise<NotificationWithSender[]> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data } = await (supabase as any)
    .from('notifications')
    .select('*')
    .eq('recipient_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50) as { data: NotificationRow[] | null }

  const rows = data ?? []

  // Resolve sender names + avatars
  const senderIds = Array.from(new Set(rows.map(r => r.sender_id).filter(Boolean))) as string[]
  const senderMap = new Map<string, { name: string; avatar_url: string | null }>()
  if (senderIds.length > 0) {
    const { data: senders } = await supabase
      .from('users')
      .select('id, full_name, email, avatar_url')
      .in('id', senderIds)
    for (const s of (senders ?? []) as { id: string; full_name: string | null; email: string; avatar_url: string | null }[]) {
      senderMap.set(s.id, { name: s.full_name || s.email, avatar_url: s.avatar_url ?? null })
    }
  }

  return rows.map(r => ({
    ...r,
    sender_name:       r.sender_id ? (senderMap.get(r.sender_id)?.name ?? null) : null,
    sender_avatar_url: r.sender_id ? (senderMap.get(r.sender_id)?.avatar_url ?? null) : null,
  }))
}

// ── Mark specific notifications as read ──────────────────────────────────────
export async function markNotificationsRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await (supabase as any)
    .from('notifications')
    .update({ read: true })
    .in('id', ids)
    .eq('recipient_id', user.id)
}

// ── Mark all notifications as read ───────────────────────────────────────────
export async function markAllRead(): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await (supabase as any)
    .from('notifications')
    .update({ read: true })
    .eq('recipient_id', user.id)
    .eq('read', false)
}

// ── Notify all admins and managers when a supervisor submits an EOD ──────────
export async function notifyManagersEODSubmitted(params: {
  senderId:    string
  teamId:      string
  teamName:    string
  pph:         number
  entryId:     string
  entryDate:   string
  supervisorName?: string
}): Promise<void> {
  const supabase = createClient()

  // Resolve sender display name + avatar
  const { data: sender } = await supabase
    .from('users')
    .select('full_name, email, avatar_url')
    .eq('id', params.senderId)
    .single() as { data: { full_name: string | null; email: string; avatar_url: string | null } | null }

  const senderName = sender?.full_name || sender?.email || params.supervisorName || 'Superviseur'
  const senderAvatarUrl = sender?.avatar_url ?? null

  // Find all admins and territory_managers (excluding the sender)
  const { data: recipients } = await supabase
    .from('users')
    .select('id')
    .in('role', ['admin', 'territory_manager'])
    .neq('id', params.senderId) as { data: { id: string }[] | null }

  const recipientIds = (recipients ?? []).map(r => r.id)
  if (recipientIds.length === 0) return

  const notifications = recipientIds.map(recipientId => ({
    recipient_id: recipientId,
    sender_id:    params.senderId,
    type:         'eod_submitted',
    title:        `EOD — ${senderName}`,
    message:      `${senderName} a soumis son rapport EOD`,
    metadata: {
      supervisor_name:      senderName,
      sender_avatar_url:    senderAvatarUrl,
      team_name:            params.teamName,
      team_id:              params.teamId,
      pph:                  params.pph,
      entry_id:             params.entryId,
      entry_date:           params.entryDate,
    },
    read: false,
  }))

  await (supabase as any).from('notifications').insert(notifications)
}
