'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from './admin'
import { createClient } from './server'
import type { UserRole } from '@/types'

// ── Guard ─────────────────────────────────────────────────────────────────────
async function requireAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }

  if (profile?.role !== 'admin') throw new Error('Unauthorized')
  return user
}

function revalidateUserPaths() {
  revalidatePath('/fr/admin/users')
  revalidatePath('/en/admin/users')
  revalidatePath('/fr/admin/dashboard')
  revalidatePath('/en/admin/dashboard')
}

// ── Create user ───────────────────────────────────────────────────────────────
export async function createUser(data: {
  email: string
  password: string
  full_name: string
  role: UserRole
}): Promise<{ error?: string }> {
  try {
    await requireAdmin()
    const admin = createAdminClient()

    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true, // internal staff — skip email confirmation
      user_metadata: {
        full_name: data.full_name,
        role: data.role,
      },
    })

    if (authError) return { error: authError.message }

    // Upsert profile — trigger handles this, but guard against race conditions
    const { error: profileError } = await admin.from('users').upsert({
      id: authData.user.id,
      email: data.email,
      full_name: data.full_name,
      role: data.role,
    })

    if (profileError) return { error: profileError.message }

    revalidateUserPaths()
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Update role ───────────────────────────────────────────────────────────────
export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<{ error?: string }> {
  try {
    const currentUser = await requireAdmin()

    if (userId === currentUser.id) {
      return { error: 'Cannot change your own role' }
    }

    const admin = createAdminClient()
    const { error } = await admin.from('users').update({ role }).eq('id', userId)

    if (error) return { error: error.message }

    revalidateUserPaths()
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Update avatar URL ─────────────────────────────────────────────────────────
export async function updateAvatarUrl(
  userId: string,
  url: string | null,
): Promise<{ error?: string }> {
  try {
    const supabase = createClient()
    const { data: { user: currentUser } } = await supabase.auth.getUser()
    if (!currentUser) return { error: 'Unauthorized' }

    // Allow updating own avatar, or admin updating anyone
    if (userId !== currentUser.id) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', currentUser.id)
        .single() as { data: { role: string } | null; error: unknown }
      if (profile?.role !== 'admin') return { error: 'Unauthorized' }
    }

    const admin = createAdminClient()
    const { error } = await admin.from('users').update({ avatar_url: url }).eq('id', userId)
    if (error) return { error: error.message }

    revalidateUserPaths()
    revalidatePath('/fr/supervisor/dashboard')
    revalidatePath('/en/supervisor/dashboard')
    revalidatePath('/fr/manager/dashboard')
    revalidatePath('/en/manager/dashboard')
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Delete user ───────────────────────────────────────────────────────────────
export async function deleteUser(userId: string): Promise<{ error?: string }> {
  try {
    const currentUser = await requireAdmin()

    if (userId === currentUser.id) {
      return { error: 'Cannot delete your own account' }
    }

    const admin = createAdminClient()
    // Deleting the auth user cascades to public.users via ON DELETE CASCADE
    const { error } = await admin.auth.admin.deleteUser(userId)

    if (error) return { error: error.message }

    revalidateUserPaths()
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}
