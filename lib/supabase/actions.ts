'use server'

import { redirect } from 'next/navigation'
import { createClient } from './server'
import type { UserRow } from '@/types'

export async function signOut(locale: string) {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect(`/${locale}`)
}

export async function getCurrentUser(): Promise<UserRow | null> {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  return profile
}
