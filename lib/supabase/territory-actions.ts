'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { TerritoryRow, TeamRow } from '@/types'
import type { TerritoryStatus } from '@/types'

export async function fetchTerritories(): Promise<TerritoryRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('territories')
    .select('*')
    .order('name', { ascending: true })
  if (error) {
    console.error('[fetchTerritories]', error.message)
    return []
  }
  return data ?? []
}

export async function fetchTeams(): Promise<TeamRow[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .order('name', { ascending: true })
  if (error) return []
  return data ?? []
}

export async function createTerritory(data: {
  name: string
  sector: string | null
  status: TerritoryStatus
  coordinates: number[][][]
}): Promise<{ id?: string; error?: string }> {
  const supabase = createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: row, error } = await (supabase as any)
    .from('territories')
    .insert(data)
    .select()
    .single() as { data: TerritoryRow | null; error: { message: string } | null }
  if (error) return { error: error.message }
  revalidatePath('/fr/admin/territories')
  revalidatePath('/en/admin/territories')
  return { id: row!.id }
}

export async function updateTerritory(
  id: string,
  data: { name?: string; status?: TerritoryStatus; coordinates?: number[][][] },
): Promise<{ error?: string }> {
  const supabase = createClient()
  const { error } = await (supabase as ReturnType<typeof createClient>)
    .from('territories')
    .update(data as never)
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/fr/admin/territories')
  revalidatePath('/en/admin/territories')
  revalidatePath('/fr/admin/settings')
  revalidatePath('/en/admin/settings')
  return {}
}

export async function deleteTerritory(id: string): Promise<{ error?: string }> {
  const supabase = createClient()
  const { error } = await supabase
    .from('territories')
    .delete()
    .eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/fr/admin/territories')
  revalidatePath('/en/admin/territories')
  return {}
}
