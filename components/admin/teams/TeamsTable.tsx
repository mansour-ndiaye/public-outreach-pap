'use client'

import { useState, useMemo, useTransition, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createTeam, updateTeam, deleteTeam } from '@/lib/supabase/team-actions'
import type { TeamWithDetails, TerritoryRow } from '@/types'

// ── Types ─────────────────────────────────────────────────────────────────────
type ManagerUser = { id: string; full_name: string | null; email: string }
type FieldUser   = { id: string; full_name: string | null; email: string }

type TeamForm = {
  name:         string
  managerId:    string
  memberIds:    string[]
  territoryIds: string[]
}

const emptyForm: TeamForm = { name: '', managerId: '', memberIds: [], territoryIds: [] }

interface TeamsTableProps {
  teams:       TeamWithDetails[]
  managers:    ManagerUser[]
  fieldUsers:  FieldUser[]
  territories: TerritoryRow[]
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inputCls = cn(
  'w-full rounded-xl px-4 py-3 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
  'transition-[border-color,box-shadow] duration-200',
)
const selectCls = cn(inputCls, 'cursor-pointer')

const btnPrimary = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-navy text-white font-body text-sm font-semibold',
  'hover:bg-brand-navy-light',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2',
  'active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnDanger = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-red text-white font-body text-sm font-semibold',
  'hover:bg-brand-red-dark',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40 focus-visible:ring-offset-2',
  'active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnGhost = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-transparent font-body text-sm font-semibold',
  'border border-slate-200 text-slate-700',
  'dark:border-white/[0.12] dark:text-white/70',
  'hover:bg-slate-100 dark:hover:bg-white/[0.06]',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2',
  'active:scale-[0.98] transition-[background-color,transform] duration-150',
)

// ── Sub-components ────────────────────────────────────────────────────────────
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative z-10 w-full max-w-lg rounded-2xl p-7 shadow-2xl animate-slide-up',
          'bg-white dark:bg-[#12163a]',
          'border border-slate-200/80 dark:border-white/[0.08]',
          'max-h-[90vh] overflow-y-auto',
        )}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className={cn(
        'fixed inset-x-0 bottom-0 z-50',
        'rounded-t-2xl',
        'bg-white dark:bg-[#141738]',
        'border-t border-slate-100 dark:border-white/[0.08]',
        'px-5 pt-3 pb-10',
        'animate-sheet-up',
        'max-h-[90vh] overflow-y-auto',
      )}>
        <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-white/20 mx-auto mb-5" />
        {children}
      </div>
    </>
  )
}

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

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 bg-brand-red/8 border border-brand-red/25 text-brand-red">
      <svg className="w-4 h-4 mt-px shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p className="font-body text-xs leading-relaxed">{message}</p>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
    </svg>
  )
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-6 h-6 rounded-full bg-brand-navy flex items-center justify-center text-white font-bold text-[10px] shrink-0 select-none">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

const STATUS_DOT: Record<string, string> = {
  active:   'bg-green-500',
  pending:  'bg-yellow-500',
  inactive: 'bg-gray-400',
}

// ── Checklist (used for members + territories) ────────────────────────────────
function Checklist<T extends { id: string }>({
  items,
  selected,
  onChange,
  emptyLabel,
  renderItem,
}: {
  items:       T[]
  selected:    string[]
  onChange:    (ids: string[]) => void
  emptyLabel:  string
  renderItem:  (item: T) => React.ReactNode
}) {
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])

  return (
    <div className={cn(
      'rounded-xl border border-slate-200 dark:border-white/[0.10]',
      'bg-slate-50 dark:bg-white/[0.03]',
      'max-h-40 overflow-y-auto',
    )}>
      {items.length === 0 ? (
        <p className="px-4 py-3 font-body text-sm text-slate-400 dark:text-white/40">{emptyLabel}</p>
      ) : (
        items.map(item => (
          <label
            key={item.id}
            className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-colors"
          >
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={() => toggle(item.id)}
              className="w-4 h-4 accent-brand-teal rounded shrink-0"
            />
            {renderItem(item)}
          </label>
        ))
      )}
    </div>
  )
}

// ── Team form body (shared between create and edit modals) ────────────────────
function TeamFormBody({
  form,
  onChange,
  managers,
  fieldUsers,
  territories,
  t,
}: {
  form:        TeamForm
  onChange:    (f: TeamForm) => void
  managers:    ManagerUser[]
  fieldUsers:  FieldUser[]
  territories: TerritoryRow[]
  t:           ReturnType<typeof useTranslations<'admin.teams'>>
}) {
  return (
    <div className="space-y-4">
      {/* Name */}
      <Field label={t('modal_name')}>
        <input
          type="text"
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
          placeholder={t('modal_name_placeholder')}
          className={inputCls}
          autoFocus
        />
      </Field>

      {/* Manager */}
      <Field label={t('modal_manager')}>
        <select
          value={form.managerId}
          onChange={e => onChange({ ...form, managerId: e.target.value })}
          className={selectCls}
        >
          <option value="">{t('modal_manager_none')}</option>
          {managers.map(m => (
            <option key={m.id} value={m.id}>{m.full_name || m.email}</option>
          ))}
        </select>
      </Field>

      {/* Members */}
      <Field label={t('modal_members')}>
        <Checklist
          items={fieldUsers}
          selected={form.memberIds}
          onChange={ids => onChange({ ...form, memberIds: ids })}
          emptyLabel={t('modal_members_none')}
          renderItem={user => (
            <div className="flex items-center gap-2 min-w-0">
              <Avatar name={user.full_name || user.email} />
              <span className="font-body text-sm text-slate-800 dark:text-white truncate">
                {user.full_name || user.email}
              </span>
            </div>
          )}
        />
        {form.memberIds.length > 0 && (
          <p className="font-body text-xs text-brand-teal mt-1">
            {t('modal_members_selected', { count: form.memberIds.length })}
          </p>
        )}
      </Field>

      {/* Territories */}
      <Field label={t('modal_territories')}>
        <Checklist
          items={territories}
          selected={form.territoryIds}
          onChange={ids => onChange({ ...form, territoryIds: ids })}
          emptyLabel={t('modal_territories_none')}
          renderItem={territory => (
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT[territory.status] ?? 'bg-gray-400')} />
              <span className="font-body text-sm text-slate-800 dark:text-white truncate">
                {territory.name}
              </span>
              {territory.sector && (
                <span className="font-body text-xs text-slate-400 dark:text-white/40 truncate">
                  · {territory.sector}
                </span>
              )}
            </div>
          )}
        />
        {form.territoryIds.length > 0 && (
          <p className="font-body text-xs text-brand-teal mt-1">
            {t('modal_territories_selected', { count: form.territoryIds.length })}
          </p>
        )}
      </Field>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function TeamsTable({ teams, managers, fieldUsers, territories }: TeamsTableProps) {
  const t = useTranslations('admin.teams')
  const [, startTransition] = useTransition()
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // ── Search ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return teams
    return teams.filter(t => t.name.toLowerCase().includes(q))
  }, [teams, search])

  // ── Modal state ────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]       = useState(false)
  const [editTeam, setEditTeam]           = useState<TeamWithDetails | null>(null)
  const [deleteTarget, setDeleteTarget]   = useState<TeamWithDetails | null>(null)
  const [form, setForm]                   = useState<TeamForm>(emptyForm)
  const [createError, setCreateError]     = useState<string | null>(null)
  const [editError, setEditError]         = useState<string | null>(null)
  const [deleteError, setDeleteError]     = useState<string | null>(null)
  const [createLoading, setCreateLoading] = useState(false)
  const [editLoading, setEditLoading]     = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)

  // ── Handlers ───────────────────────────────────────────────────────────────
  const openCreate = () => {
    setForm(emptyForm)
    setCreateError(null)
    setCreateOpen(true)
  }

  const openEdit = (team: TeamWithDetails) => {
    setForm({
      name:         team.name,
      managerId:    team.manager_id ?? '',
      memberIds:    team.member_ids,
      territoryIds: team.territory_ids,
    })
    setEditError(null)
    setEditTeam(team)
  }

  const handleCreate = () => {
    if (!form.name.trim()) return
    setCreateLoading(true)
    setCreateError(null)
    startTransition(async () => {
      const result = await createTeam({
        name:         form.name.trim(),
        manager_id:   form.managerId || null,
        member_ids:   form.memberIds,
        territory_ids: form.territoryIds,
      })
      setCreateLoading(false)
      if (result.error) {
        setCreateError(result.error)
      } else {
        setCreateOpen(false)
      }
    })
  }

  const handleEdit = () => {
    if (!editTeam || !form.name.trim()) return
    setEditLoading(true)
    setEditError(null)
    startTransition(async () => {
      const result = await updateTeam(editTeam.id, {
        name:         form.name.trim(),
        manager_id:   form.managerId || null,
        member_ids:   form.memberIds,
        territory_ids: form.territoryIds,
      })
      setEditLoading(false)
      if (result.error) {
        setEditError(result.error)
      } else {
        setEditTeam(null)
      }
    })
  }

  const handleDelete = () => {
    if (!deleteTarget) return
    setDeleteLoading(true)
    setDeleteError(null)
    startTransition(async () => {
      const result = await deleteTeam(deleteTarget.id)
      setDeleteLoading(false)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        setDeleteTarget(null)
      }
    })
  }

  // ── Modal wrappers (desktop vs mobile) ────────────────────────────────────
  const ModalWrapper = isTouch ? BottomSheet : Modal

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Toolbar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <div className="relative flex-1">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-white/30 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('search_placeholder')}
            className={cn(inputCls, 'pl-10')}
          />
        </div>
        <button onClick={openCreate} className={cn(btnPrimary, 'whitespace-nowrap')}>
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
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
                {[t('col_name'), t('col_manager'), t('col_members'), t('col_territories'), t('col_actions')].map(col => (
                  <th key={col} className="px-5 py-3.5 text-left font-body text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/40">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.05]">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center font-body text-sm text-slate-400 dark:text-white/30">
                    {t('empty')}
                  </td>
                </tr>
              ) : (
                filtered.map(team => (
                  <tr key={team.id} className="bg-white dark:bg-transparent hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors duration-100">
                    {/* Name */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-brand-navy/10 dark:bg-brand-navy/40 flex items-center justify-center shrink-0">
                          <svg className="w-4 h-4 text-brand-navy dark:text-white/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                            <circle cx="9" cy="7" r="4"/>
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                          </svg>
                        </div>
                        <p className="font-body text-sm font-semibold text-slate-900 dark:text-white">
                          {team.name}
                        </p>
                      </div>
                    </td>

                    {/* Manager */}
                    <td className="px-5 py-4 font-body text-sm text-slate-600 dark:text-white/60">
                      {team.manager_name ?? (
                        <span className="text-slate-300 dark:text-white/25 italic">{t('no_manager')}</span>
                      )}
                    </td>

                    {/* Members count */}
                    <td className="px-5 py-4">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full',
                        'font-body text-xs font-semibold',
                        'bg-brand-navy/8 dark:bg-white/10 text-brand-navy dark:text-white/80',
                        'border border-brand-navy/15 dark:border-white/10',
                      )}>
                        {team.member_ids.length}
                      </span>
                    </td>

                    {/* Territories count */}
                    <td className="px-5 py-4">
                      <span className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full',
                        'font-body text-xs font-semibold',
                        'bg-brand-teal/10 text-brand-teal',
                        'border border-brand-teal/20',
                      )}>
                        {team.territory_ids.length}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => openEdit(team)}
                          title={t('modal_edit_title')}
                          className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-lg',
                            'text-slate-400 dark:text-white/30',
                            'hover:bg-brand-navy/8 hover:text-brand-navy dark:hover:bg-white/10 dark:hover:text-white',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                            'active:scale-90 transition-[background-color,color,transform] duration-150',
                          )}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => { setDeleteError(null); setDeleteTarget(team) }}
                          title={t('delete_title')}
                          className={cn(
                            'flex items-center justify-center w-8 h-8 rounded-lg',
                            'text-slate-400 dark:text-white/30',
                            'hover:bg-brand-red/8 hover:text-brand-red',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40',
                            'active:scale-90 transition-[background-color,color,transform] duration-150',
                          )}
                        >
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

      {/* ══════════════════════════════════════════════════════════════════════
          Modal: Create team
      ══════════════════════════════════════════════════════════════════════ */}
      {createOpen && (
        <ModalWrapper onClose={() => setCreateOpen(false)}>
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-6">
            {t('modal_create_title')}
          </h2>
          <TeamFormBody
            form={form}
            onChange={setForm}
            managers={managers}
            fieldUsers={fieldUsers}
            territories={territories}
            t={t}
          />
          {createError && <div className="mt-4"><ErrorBanner message={createError} /></div>}
          <div className="flex gap-3 mt-7">
            <button
              onClick={handleCreate}
              disabled={createLoading || !form.name.trim()}
              className={cn(btnPrimary, 'flex-1')}
            >
              {createLoading ? <><Spinner />{t('saving')}</> : t('save')}
            </button>
            <button onClick={() => setCreateOpen(false)} className={btnGhost}>
              {t('cancel')}
            </button>
          </div>
        </ModalWrapper>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Modal: Edit team
      ══════════════════════════════════════════════════════════════════════ */}
      {editTeam && (
        <ModalWrapper onClose={() => setEditTeam(null)}>
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-6">
            {t('modal_edit_title')}
          </h2>
          <TeamFormBody
            form={form}
            onChange={setForm}
            managers={managers}
            fieldUsers={fieldUsers}
            territories={territories}
            t={t}
          />
          {editError && <div className="mt-4"><ErrorBanner message={editError} /></div>}
          <div className="flex gap-3 mt-7">
            <button
              onClick={handleEdit}
              disabled={editLoading || !form.name.trim()}
              className={cn(btnPrimary, 'flex-1')}
            >
              {editLoading ? <><Spinner />{t('saving')}</> : t('save')}
            </button>
            <button onClick={() => setEditTeam(null)} className={btnGhost}>
              {t('cancel')}
            </button>
          </div>
        </ModalWrapper>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          Modal: Delete team
      ══════════════════════════════════════════════════════════════════════ */}
      {deleteTarget && (
        <ModalWrapper onClose={() => setDeleteTarget(null)}>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-brand-red/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-brand-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div>
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                {t('delete_title')}
              </h2>
              <p className="font-body text-sm font-semibold text-brand-navy dark:text-white/80 mt-0.5">
                {deleteTarget.name}
              </p>
            </div>
          </div>
          <p className="font-body text-sm text-slate-500 dark:text-white/40 leading-relaxed mb-5">
            {t('delete_desc')}
          </p>
          {deleteError && <div className="mb-4"><ErrorBanner message={deleteError} /></div>}
          <div className="flex gap-3">
            <button
              onClick={handleDelete}
              disabled={deleteLoading}
              className={cn(btnDanger, 'flex-1')}
            >
              {deleteLoading ? <><Spinner />{t('delete_deleting')}</> : t('delete_confirm')}
            </button>
            <button onClick={() => setDeleteTarget(null)} className={btnGhost}>
              {t('cancel')}
            </button>
          </div>
        </ModalWrapper>
      )}
    </>
  )
}
