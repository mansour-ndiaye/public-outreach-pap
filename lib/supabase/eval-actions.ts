'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export type EvalEntry = {
  id:                    string
  eod_entry_id:          string | null
  supervisor_id:         string | null
  supervisor_name:       string | null
  team_id:               string | null
  team_name:             string | null
  eval_date:             string
  eval_day:              string   // D1–D5
  eval_name:             string
  coached_by_supervisor: boolean
  coach_name:            string | null
  eval_pph:              number
  eval_canvas_hours:     number | null
  eval_pac_total:        number | null
  notes:                 string | null
  created_at:            string
}

// ── Submit a new eval ─────────────────────────────────────────────────────────
export async function submitEval(data: {
  eod_entry_id:          string | null
  supervisor_id:         string
  supervisor_name:       string
  team_id:               string
  team_name:             string
  eval_date:             string
  eval_day:              string
  eval_name:             string
  coached_by_supervisor: boolean
  coach_name:            string | null
  eval_pph:              number
  eval_canvas_hours:     number | null
  eval_pac_total:        number | null
  notes:                 string | null
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error } = await (supabase as any)
    .from('evals')
    .insert(data)
    .select()
    .single() as { data: { id: string } | null; error: { message: string } | null }

  if (error || !row) return { error: error?.message ?? 'Failed to submit eval' }

  await notifyEvalSubmitted({
    senderId:       data.supervisor_id,
    supervisorName: data.supervisor_name,
    teamName:       data.team_name,
    evalDay:        data.eval_day,
    evalPph:        data.eval_pph,
    evalId:         row.id,
    evalDate:       data.eval_date,
  })

  revalidatePath('/fr/supervisor/dashboard')
  revalidatePath('/en/supervisor/dashboard')
  revalidatePath('/fr/manager/dashboard')
  revalidatePath('/en/manager/dashboard')
  revalidatePath('/fr/admin/evals')
  revalidatePath('/en/admin/evals')

  return { id: row.id }
}

// ── Fetch evals for a specific supervisor ─────────────────────────────────────
export async function fetchMyEvals(supervisorId: string): Promise<EvalEntry[]> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('evals')
    .select('*')
    .eq('supervisor_id', supervisorId)
    .order('eval_date', { ascending: false })
    .limit(200)
  return (data ?? []) as EvalEntry[]
}

// ── Fetch all evals (admin / manager) ─────────────────────────────────────────
export async function fetchAllEvals(): Promise<EvalEntry[]> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('evals')
    .select('*')
    .order('eval_date', { ascending: false })
    .limit(500)
  return (data ?? []) as EvalEntry[]
}

// ── Notify admins + managers when an eval is submitted ────────────────────────
async function notifyEvalSubmitted(params: {
  senderId:       string
  supervisorName: string
  teamName:       string
  evalDay:        string
  evalPph:        number
  evalId:         string
  evalDate:       string
}): Promise<void> {
  const supabase = createClient()

  const { data: recipients } = await supabase
    .from('users')
    .select('id')
    .in('role', ['admin', 'territory_manager'])
    .neq('id', params.senderId) as { data: { id: string }[] | null }

  const recipientIds = (recipients ?? []).map(r => r.id)
  if (recipientIds.length === 0) return

  const pphStr  = `$${params.evalPph.toFixed(2)}`
  const message = `${params.supervisorName} a soumis une évaluation — ${params.evalDay} · PPH: ${pphStr}`

  const notifications = recipientIds.map(recipientId => ({
    recipient_id: recipientId,
    sender_id:    params.senderId,
    type:         'eval_submitted',
    title:        `Éval — ${params.supervisorName}`,
    message,
    metadata: {
      supervisor_name: params.supervisorName,
      team_name:       params.teamName,
      eval_day:        params.evalDay,
      eval_pph:        params.evalPph,
      eval_id:         params.evalId,
      eval_date:       params.evalDate,
    },
    read: false,
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('notifications').insert(notifications)
}
