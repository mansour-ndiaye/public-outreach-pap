'use client'

import { useState, useMemo, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createUser, updateUserRole, deleteUser } from '@/lib/supabase/user-actions'
import type { UserRow, UserRole } from '@/types'

// ── Role config ───────────────────────────────────────────────────────────────
const ROLES: UserRole[] = ['admin', 'territory_manager', 'supervisor', 'field_team']

const ROLE_BADGE: Record<UserRole, string> = {
  admin:             'bg-brand-red/10 text-brand-red border-brand-red/25',
  territory_manager: 'bg-brand-navy/8 text-brand-navy border-brand-navy/20 dark:bg-white/10 dark:text-white dark:border-white/15',
  supervisor:        'bg-brand-teal/10 text-brand-teal border-brand-teal/25',
  field_team:        'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/8 dark:text-white/60 dark:border-white/10',
}

// ── Shared modal wrapper ──────────────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={cn(
          'relative z-10 w-full max-w-md rounded-2xl p-7 shadow-2xl animate-slide-up',
          'bg-white dark:bg-[#12163a]',
          'border border-slate-200/80 dark:border-white/[0.08]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// ── Field component ───────────────────────────────────────────────────────────
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block font-body text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/50">
        {label}
      </label>
      {children}
    </div>
  )
}

const inputCls = cn(
  'w-full rounded-xl px-4 py-3 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'hover:border-brand-navy/30 dark:hover:border-white/20',
  'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
  'transition-[border-color,box-shadow] duration-200',
)

const selectCls = cn(inputCls, 'cursor-pointer')

// ── Error banner ──────────────────────────────────────────────────────────────
function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-brand-red/8 border border-brand-red/25 text-brand-red animate-fade-in">
      <svg className="w-4 h-4 mt-px shrink-0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p className="font-body text-xs leading-relaxed">{message}</p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
interface UsersTableProps {
  users: UserRow[]
}

export function UsersTable({ users }: UsersTableProps) {
  const t = useTranslations('admin.users')
  const tRoles = useTranslations('roles')
  const [, startTransition] = useTransition()

  // ── Search ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return users
    return users.filter(
      (u) =>
        u.full_name?.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q)
    )
  }, [users, search])

  // ── Modal state ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser]   = useState<UserRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)

  // ── Create form state ──────────────────────────────────────────────────────
  const [createForm, setCreateForm] = useState({
    full_name: '', email: '', password: '', role: 'field_team' as UserRole,
  })
  const [showCreatePwd, setShowCreatePwd] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const resetCreate = () => {
    setCreateForm({ full_name: '', email: '', password: '', role: 'field_team' })
    setCreateError(null)
    setShowCreatePwd(false)
  }

  const handleCreate = () => {
    setCreateLoading(true)
    setCreateError(null)
    startTransition(async () => {
      const result = await createUser(createForm)
      setCreateLoading(false)
      if (result.error) {
        setCreateError(result.error)
      } else {
        setCreateOpen(false)
        resetCreate()
      }
    })
  }

  // ── Edit role state ────────────────────────────────────────────────────────
  const [editRole, setEditRole]     = useState<UserRole>('field_team')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError]   = useState<string | null>(null)

  const openEdit = (user: UserRow) => {
    setEditUser(user)
    setEditRole(user.role as UserRole)
    setEditError(null)
  }

  const handleEditRole = () => {
    if (!editUser) return
    setEditLoading(true)
    setEditError(null)
    startTransition(async () => {
      const result = await updateUserRole(editUser.id, editRole)
      setEditLoading(false)
      if (result.error) {
        setEditError(result.error)
      } else {
        setEditUser(null)
      }
    })
  }

  // ── Delete state ───────────────────────────────────────────────────────────
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteError, setDeleteError]   = useState<string | null>(null)

  const openDelete = (user: UserRow) => {
    setDeleteTarget(user)
    setDeleteError(null)
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteUser(deleteTarget.id)
      setDeleteLoading(false)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setDeleteTarget(null)
      }
    })
  }

  // ── Shared button styles ───────────────────────────────────────────────────
  const btnPrimary = cn(
    'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
    'bg-brand-navy text-white font-body text-sm font-semibold',
    'shadow-navy-sm hover:bg-brand-navy-light hover:shadow-navy-md',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2',
    'active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
    'transition-[background-color,box-shadow,transform,opacity] duration-150',
  )
  const btnDanger = cn(
    'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
    'bg-brand-red text-white font-body text-sm font-semibold',
    'shadow-red-sm hover:bg-brand-red-dark',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40 focus-visible:ring-offset-2',
    'active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
    'transition-[background-color,box-shadow,transform,opacity] duration-150',
  )
  const btnGhost = cn(
    'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
    'bg-slate-100 text-slate-700 font-body text-sm font-semibold',
    'dark:bg-white/8 dark:text-white/70',
    'hover:bg-slate-200 dark:hover:bg-white/12',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
    'active:scale-[0.98]',
    'transition-[background-color,transform] duration-150',
  )

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/30 pointer-events-none" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search_placeholder')}
            className={cn(inputCls, 'pl-10')}
          />
        </div>

        {/* Create button */}
        <button
          onClick={() => { resetCreate(); setCreateOpen(true) }}
          className={cn(btnPrimary, 'whitespace-nowrap')}
        >
          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {t('create_btn')}
        </button>
      </div>

      {/* ── Table ── */}
      <div className={cn(
        'rounded-2xl overflow-hidden',
        'border border-slate-200/80 dark:border-white/[0.07]',
        'shadow-[0_1px_4px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)]',
        'dark:shadow-[0_1px_4px_rgba(0,0,0,0.2)]',
      )}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 dark:bg-white/[0.03] border-b border-slate-200/80 dark:border-white/[0.07]">
                {[t('col_name'), t('col_role'), t('col_created'), t('col_actions')].map((col) => (
                  <th
                    key={col}
                    className="px-5 py-3.5 text-left font-body text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center font-body text-sm text-slate-400 dark:text-white/30">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                filtered.map((user) => (
                  <tr
                    key={user.id}
                    className="bg-white dark:bg-transparent hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors duration-100"
                  >
                    {/* Name + email */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-navy flex items-center justify-center text-white font-display font-bold text-xs shrink-0 select-none">
                          {(user.full_name || user.email).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-body text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {user.full_name || '—'}
                          </p>
                          <p className="font-body text-xs text-slate-500 dark:text-white/40 truncate">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Role badge */}
                    <td className="px-5 py-4">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full',
                        'font-body text-xs font-semibold border',
                        ROLE_BADGE[user.role as UserRole] ?? ROLE_BADGE.field_team,
                      )}>
                        {tRoles(user.role as UserRole)}
                      </span>
                    </td>

                    {/* Created at */}
                    <td className="px-5 py-4 font-body text-sm text-slate-500 dark:text-white/40 whitespace-nowrap">
                      {new Date(user.created_at).toLocaleDateString('fr-CA', {
                        year: 'numeric', month: 'short', day: 'numeric',
                      })}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        {/* Edit role */}
                        <button
                          onClick={() => openEdit(user)}
                          title="Edit role"
                          className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-lg',
                            'text-slate-400 dark:text-white/30',
                            'hover:bg-brand-navy/8 hover:text-brand-navy dark:hover:bg-white/10 dark:hover:text-white',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                            'active:scale-90 transition-[background-color,color,transform] duration-150',
                          )}
                        >
                          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>

                        {/* Delete */}
                        <button
                          onClick={() => openDelete(user)}
                          title="Delete user"
                          className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-lg',
                            'text-slate-400 dark:text-white/30',
                            'hover:bg-brand-red/8 hover:text-brand-red',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40',
                            'active:scale-90 transition-[background-color,color,transform] duration-150',
                          )}
                        >
                          <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: Create user
      ════════════════════════════════════════════════════════════════════════ */}
      {createOpen && (
        <Modal onClose={() => { setCreateOpen(false); resetCreate() }}>
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-6">
            {t('modal_create_title')}
          </h2>

          <div className="space-y-4">
            <Field label={t('modal_create_name')}>
              <input
                type="text"
                value={createForm.full_name}
                onChange={(e) => setCreateForm((f) => ({ ...f, full_name: e.target.value }))}
                placeholder={t('modal_create_name_placeholder')}
                className={inputCls}
              />
            </Field>

            <Field label={t('modal_create_email')}>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="email@publicoutreach.ca"
                className={inputCls}
              />
            </Field>

            <Field label={t('modal_create_password')}>
              <div className="relative">
                <input
                  type={showCreatePwd ? 'text' : 'password'}
                  value={createForm.password}
                  onChange={(e) => setCreateForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="••••••••"
                  className={cn(inputCls, 'pr-11')}
                />
                <button
                  type="button"
                  onClick={() => setShowCreatePwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-slate-400 hover:text-slate-600 dark:text-white/30 dark:hover:text-white/60 transition-colors"
                >
                  {showCreatePwd ? (
                    <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </Field>

            <Field label={t('modal_create_role')}>
              <select
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value as UserRole }))}
                className={selectCls}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{tRoles(r)}</option>
                ))}
              </select>
            </Field>

            {createError && <ErrorBanner message={createError} />}
          </div>

          <div className="flex gap-3 mt-7">
            <button
              onClick={handleCreate}
              disabled={createLoading || !createForm.email || !createForm.password || !createForm.full_name}
              className={cn(btnPrimary, 'flex-1')}
            >
              {createLoading ? (
                <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : null}
              {t('modal_create_submit')}
            </button>
            <button
              onClick={() => { setCreateOpen(false); resetCreate() }}
              className={btnGhost}
            >
              {t('cancel')}
            </button>
          </div>
        </Modal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: Edit role
      ════════════════════════════════════════════════════════════════════════ */}
      {editUser && (
        <Modal onClose={() => setEditUser(null)}>
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-1">
            {t('modal_edit_title')}
          </h2>
          <p className="font-body text-sm text-slate-500 dark:text-white/45 mb-6">
            {editUser.full_name || editUser.email}
          </p>

          <Field label={t('modal_edit_role')}>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value as UserRole)}
              className={selectCls}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>{tRoles(r)}</option>
              ))}
            </select>
          </Field>

          {editError && <ErrorBanner message={editError} />}

          <div className="flex gap-3 mt-7">
            <button
              onClick={handleEditRole}
              disabled={editLoading || editRole === editUser.role}
              className={cn(btnPrimary, 'flex-1')}
            >
              {editLoading ? (
                <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : null}
              {t('modal_edit_save')}
            </button>
            <button onClick={() => setEditUser(null)} className={btnGhost}>
              {t('cancel')}
            </button>
          </div>
        </Modal>
      )}

      {/* ═══════════════════════════════════════════════════════════════════════
          Modal: Delete confirmation
      ════════════════════════════════════════════════════════════════════════ */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          {/* Warning icon */}
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-red/10 mb-5">
            <svg className="w-6 h-6 text-brand-red" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>

          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white mb-2">
            {t('modal_delete_title')}
          </h2>
          <p className="font-body text-sm text-slate-600 dark:text-white/50 mb-1">
            <span className="font-semibold text-slate-900 dark:text-white">
              {deleteTarget.full_name || deleteTarget.email}
            </span>
          </p>
          <p className="font-body text-sm text-slate-500 dark:text-white/40 mb-6 leading-relaxed">
            {t('modal_delete_desc')}
          </p>

          {deleteError && <ErrorBanner message={deleteError} />}

          <div className="flex gap-3 mt-2">
            <button
              onClick={handleDelete}
              disabled={deleteLoading}
              className={cn(btnDanger, 'flex-1')}
            >
              {deleteLoading ? (
                <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
              ) : null}
              {t('modal_delete_confirm')}
            </button>
            <button onClick={() => setDeleteTarget(null)} className={btnGhost}>
              {t('cancel')}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
