'use client'

import { useState, useTransition, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { updateTerritory, deleteTerritory } from '@/lib/supabase/territory-actions'
import { updateUserRole, resetUserPassword, deleteUser } from '@/lib/supabase/user-actions'
import { updateTeam, deleteTeam } from '@/lib/supabase/team-actions'
import type { TerritoryRow, TeamRow, UserRow, TerritoryStatus, UserRole } from '@/types'
import type { TeamWithDetails } from '@/types'

// ── Shared helpers ────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  territory_manager: 'Gestionnaire',
  supervisor: 'Superviseur',
  field_team: 'Terrain',
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Actif',
  pending: 'En attente',
  inactive: 'Inactif',
}

const STATUS_DOT: Record<string, string> = {
  active:   'bg-green-500',
  pending:  'bg-yellow-500',
  inactive: 'bg-gray-400',
}

const inputCls = cn(
  'w-full rounded-xl px-3 py-2 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white',
  'focus:outline-none focus:ring-2 focus:ring-brand-teal/40 focus:border-brand-teal',
  'transition-[border-color,box-shadow]',
)
const selectCls = cn(inputCls, 'cursor-pointer')

// ── Section card wrapper ──────────────────────────────────────────────────────
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.07] overflow-hidden bg-white dark:bg-white/[0.02] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
      <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06]">
        <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">{title}</h2>
        {subtitle && <p className="font-body text-xs text-slate-400 dark:text-white/40 mt-0.5">{subtitle}</p>}
      </div>
      <div className="divide-y divide-slate-100 dark:divide-white/[0.05]">{children}</div>
    </div>
  )
}

function Toast({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-50',
      'flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg',
      'font-body text-sm font-semibold animate-fade-in',
      type === 'success'
        ? 'bg-brand-teal text-white'
        : 'bg-brand-red text-white',
    )}>
      {type === 'success' ? (
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      )}
      {message}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface AdminSettingsProps {
  territories:     TerritoryRow[]
  teams:           TeamRow[]
  teamsWithDetails: TeamWithDetails[]
  users:           UserRow[]
  locale?:         string
}

// ── MAP STYLE PREFERENCE KEY ──────────────────────────────────────────────────
const PREF_MAP_STYLE_KEY  = 'pap-pref-map-style'
const PREF_LOCALE_KEY     = 'pap-pref-locale'

export default function AdminSettings({
  territories: initialTerritories,
  teams,
  teamsWithDetails: initialTeams,
  users: initialUsers,
  locale,
}: AdminSettingsProps) {
  const [, startTransition] = useTransition()
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── Local state ─────────────────────────────────────────────────────────────
  const [territories, setTerritories] = useState(initialTerritories)
  const [teamsWithDetails, setTeams]  = useState(initialTeams)
  const [users, setUsers]             = useState(initialUsers)

  // ── Active section (accordion-style on mobile) ────────────────────────────
  const [openSection, setOpenSection] = useState<string | null>('zones')

  // ── Preferences ──────────────────────────────────────────────────────────
  const [prefMapStyle, setPrefMapStyle] = useState('dark')
  const [prefLocale,   setPrefLocale]   = useState(locale ?? 'fr')
  useEffect(() => {
    const s = localStorage.getItem(PREF_MAP_STYLE_KEY)
    const l = localStorage.getItem(PREF_LOCALE_KEY)
    if (s) setPrefMapStyle(s)
    if (l) setPrefLocale(l)
  }, [])
  const savePrefs = () => {
    localStorage.setItem(PREF_MAP_STYLE_KEY, prefMapStyle)
    localStorage.setItem(PREF_LOCALE_KEY, prefLocale)
    showToast('Préférences sauvegardées')
  }

  const isFr = locale !== 'en'

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6 pb-20">
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* ── SECTION A: ZONES ──────────────────────────────────────────────── */}
      <Section
        title={isFr ? 'Gestion des zones' : 'Zone Management'}
        subtitle={isFr ? `${territories.length} zones au total` : `${territories.length} total zones`}
      >
        {territories.length === 0 ? (
          <p className="px-5 py-8 text-center font-body text-sm text-slate-400 dark:text-white/30">
            {isFr ? 'Aucune zone configurée.' : 'No zones configured.'}
          </p>
        ) : territories.map(zone => (
          <ZoneRow
            key={zone.id}
            zone={zone}
            teams={teams}
            locale={locale}
            onUpdate={(id, data) => {
              startTransition(async () => {
                const res = await updateTerritory(id, data)
                if (res.error) { showToast(res.error, 'error'); return }
                setTerritories(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
                showToast(isFr ? 'Zone mise à jour' : 'Zone updated')
              })
            }}
            onDelete={(id) => {
              startTransition(async () => {
                const res = await deleteTerritory(id)
                if (res.error) { showToast(res.error, 'error'); return }
                setTerritories(prev => prev.filter(t => t.id !== id))
                showToast(isFr ? 'Zone supprimée' : 'Zone deleted')
              })
            }}
          />
        ))}
      </Section>

      {/* ── SECTION B: TEAMS ─────────────────────────────────────────────── */}
      <Section
        title={isFr ? 'Gestion des équipes' : 'Team Management'}
        subtitle={isFr ? `${teamsWithDetails.length} équipes` : `${teamsWithDetails.length} teams`}
      >
        {teamsWithDetails.length === 0 ? (
          <p className="px-5 py-8 text-center font-body text-sm text-slate-400 dark:text-white/30">
            {isFr ? 'Aucune équipe.' : 'No teams.'}
          </p>
        ) : teamsWithDetails.map(team => (
          <TeamRow
            key={team.id}
            team={team}
            allUsers={users}
            locale={locale}
            onUpdate={(id, name) => {
              startTransition(async () => {
                const existing = teamsWithDetails.find(t => t.id === id)!
                const res = await updateTeam(id, {
                  name,
                  manager_id: existing.manager_id ?? null,
                  member_ids: existing.member_ids,
                  territory_ids: existing.territory_ids,
                })
                if (res.error) { showToast(res.error, 'error'); return }
                setTeams(prev => prev.map(t => t.id === id ? { ...t, name } : t))
                showToast(isFr ? 'Équipe mise à jour' : 'Team updated')
              })
            }}
            onDelete={(id) => {
              startTransition(async () => {
                const res = await deleteTeam(id)
                if (res.error) { showToast(res.error, 'error'); return }
                setTeams(prev => prev.filter(t => t.id !== id))
                showToast(isFr ? 'Équipe supprimée' : 'Team deleted')
              })
            }}
          />
        ))}
      </Section>

      {/* ── SECTION C: USERS ─────────────────────────────────────────────── */}
      <Section
        title={isFr ? 'Gestion des utilisateurs' : 'User Management'}
        subtitle={isFr ? `${users.length} utilisateurs` : `${users.length} users`}
      >
        {users.map(user => (
          <UserRow
            key={user.id}
            user={user}
            locale={locale}
            onRoleChange={(id, role) => {
              startTransition(async () => {
                const res = await updateUserRole(id, role)
                if (res.error) { showToast(res.error, 'error'); return }
                setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u))
                showToast(isFr ? 'Rôle mis à jour' : 'Role updated')
              })
            }}
            onResetPassword={(id) => {
              startTransition(async () => {
                const res = await resetUserPassword(id)
                if (res.error) { showToast(res.error, 'error'); return }
                showToast(isFr ? 'Email de réinitialisation envoyé' : 'Reset email sent')
              })
            }}
            onDelete={(id) => {
              startTransition(async () => {
                const res = await deleteUser(id)
                if (res.error) { showToast(res.error, 'error'); return }
                setUsers(prev => prev.filter(u => u.id !== id))
                showToast(isFr ? 'Utilisateur supprimé' : 'User deleted')
              })
            }}
          />
        ))}
      </Section>

      {/* ── SECTION D: PREFERENCES ───────────────────────────────────────── */}
      <div className="rounded-2xl border border-slate-200/80 dark:border-white/[0.07] overflow-hidden bg-white dark:bg-white/[0.02] shadow-[0_1px_4px_rgba(0,0,0,0.04)]">
        <div className="px-5 py-4 border-b border-slate-100 dark:border-white/[0.06]">
          <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
            {isFr ? 'Préférences' : 'App Preferences'}
          </h2>
          <p className="font-body text-xs text-slate-400 dark:text-white/40 mt-0.5">
            {isFr ? 'Sauvegardées localement dans votre navigateur' : 'Saved locally in your browser'}
          </p>
        </div>
        <div className="px-5 py-5 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40 mb-2">
                {isFr ? 'Style de carte par défaut' : 'Default map style'}
              </label>
              <select value={prefMapStyle} onChange={e => setPrefMapStyle(e.target.value)} className={selectCls}>
                <option value="dark">{isFr ? 'Sombre' : 'Dark'}</option>
                <option value="streets">{isFr ? 'Rues' : 'Streets'}</option>
                <option value="satellite">{isFr ? 'Satellite' : 'Satellite'}</option>
                <option value="light">{isFr ? 'Clair' : 'Light'}</option>
                <option value="navigation">{isFr ? 'Navigation' : 'Navigation'}</option>
              </select>
            </div>
            <div>
              <label className="block font-body text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/40 mb-2">
                {isFr ? 'Langue par défaut' : 'Default language'}
              </label>
              <select value={prefLocale} onChange={e => setPrefLocale(e.target.value)} className={selectCls}>
                <option value="fr">Français</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
          <button
            onClick={savePrefs}
            className={cn(
              'flex items-center gap-2 px-5 h-10 rounded-xl',
              'bg-brand-navy text-white font-body text-sm font-semibold',
              'hover:bg-brand-navy-light active:scale-[0.98]',
              'transition-all',
            )}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
            </svg>
            {isFr ? 'Sauvegarder' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Zone Row ──────────────────────────────────────────────────────────────────
function ZoneRow({
  zone, teams, locale,
  onUpdate, onDelete,
}: {
  zone:     TerritoryRow
  teams:    TeamRow[]
  locale?:  string
  onUpdate: (id: string, data: { name?: string; status?: TerritoryStatus }) => void
  onDelete: (id: string) => void
}) {
  const isFr = locale !== 'en'
  const [editing, setEditing]     = useState(false)
  const [name,    setName]        = useState(zone.name)
  const [status,  setStatus]      = useState<TerritoryStatus>(zone.status as TerritoryStatus)
  const [confirm, setConfirm]     = useState(false)

  const save = () => {
    onUpdate(zone.id, { name: name.trim() || zone.name, status })
    setEditing(false)
  }

  if (confirm) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-brand-red/5">
        <p className="font-body text-sm text-brand-red">
          {isFr ? `Supprimer « ${zone.name} » ?` : `Delete "${zone.name}"?`}
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setConfirm(false)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
            {isFr ? 'Annuler' : 'Cancel'}
          </button>
          <button onClick={() => onDelete(zone.id)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold bg-brand-red text-white hover:bg-brand-red/90 transition-colors">
            {isFr ? 'Supprimer' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="px-5 py-3 space-y-3 bg-slate-50/80 dark:bg-white/[0.02]">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          className={inputCls}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <select value={status} onChange={e => setStatus(e.target.value as TerritoryStatus)} className={cn(selectCls, 'flex-1')}>
            <option value="active">{isFr ? 'Actif' : 'Active'}</option>
            <option value="pending">{isFr ? 'En attente' : 'Pending'}</option>
            <option value="inactive">{isFr ? 'Inactif' : 'Inactive'}</option>
          </select>
          <button onClick={save} className="flex-1 h-9 rounded-xl font-body text-xs font-semibold bg-brand-teal text-white hover:opacity-90 transition-opacity">
            {isFr ? 'Sauvegarder' : 'Save'}
          </button>
          <button onClick={() => { setEditing(false); setName(zone.name); setStatus(zone.status as TerritoryStatus) }} className="h-9 px-3 rounded-xl font-body text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors">
      <span className={cn('w-2 h-2 rounded-full shrink-0', STATUS_DOT[zone.status] ?? 'bg-gray-400')} />
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium text-slate-800 dark:text-white truncate">{zone.name}</p>
        {zone.sector && <p className="font-body text-xs text-slate-400 dark:text-white/30 truncate">{zone.sector}</p>}
      </div>
      <span className="font-body text-xs text-slate-400 dark:text-white/30 shrink-0 hidden sm:block">
        {STATUS_LABELS[zone.status] ?? zone.status}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => setEditing(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-navy hover:bg-brand-navy/8 dark:hover:text-white dark:hover:bg-white/10 transition-colors" title={isFr ? 'Modifier' : 'Edit'}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button onClick={() => setConfirm(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-red hover:bg-brand-red/8 transition-colors" title={isFr ? 'Supprimer' : 'Delete'}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  )
}

// ── Team Row ──────────────────────────────────────────────────────────────────
function TeamRow({
  team, allUsers, locale,
  onUpdate, onDelete,
}: {
  team:     TeamWithDetails
  allUsers: UserRow[]
  locale?:  string
  onUpdate: (id: string, name: string) => void
  onDelete: (id: string) => void
}) {
  const isFr = locale !== 'en'
  const [editing, setEditing] = useState(false)
  const [name, setName]       = useState(team.name)
  const [confirm, setConfirm] = useState(false)

  const save = () => {
    onUpdate(team.id, name.trim() || team.name)
    setEditing(false)
  }

  const memberCount = team.member_ids?.length ?? 0
  const memberNames = allUsers
    .filter(u => team.member_ids?.includes(u.id))
    .map(u => u.full_name || u.email)
    .slice(0, 3)

  if (confirm) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-brand-red/5">
        <p className="font-body text-sm text-brand-red">
          {isFr ? `Supprimer l'équipe « ${team.name} » ?` : `Delete team "${team.name}"?`}
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setConfirm(false)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
            {isFr ? 'Annuler' : 'Cancel'}
          </button>
          <button onClick={() => onDelete(team.id)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold bg-brand-red text-white hover:bg-brand-red/90 transition-colors">
            {isFr ? 'Supprimer' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  if (editing) {
    return (
      <div className="px-5 py-3 space-y-2 bg-slate-50/80 dark:bg-white/[0.02]">
        <input value={name} onChange={e => setName(e.target.value)} className={inputCls} autoFocus />
        <div className="flex gap-2">
          <button onClick={save} className="flex-1 h-9 rounded-xl font-body text-xs font-semibold bg-brand-teal text-white hover:opacity-90 transition-opacity">
            {isFr ? 'Sauvegarder' : 'Save'}
          </button>
          <button onClick={() => { setEditing(false); setName(team.name) }} className="h-9 px-3 rounded-xl font-body text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
            ✕
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors">
      <div className="w-8 h-8 rounded-xl bg-brand-navy/10 dark:bg-white/10 flex items-center justify-center shrink-0">
        <svg className="w-4 h-4 text-brand-navy dark:text-white/70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium text-slate-800 dark:text-white truncate">{team.name}</p>
        {memberCount > 0 && (
          <p className="font-body text-xs text-slate-400 dark:text-white/30 truncate">
            {memberNames.join(', ')}{memberCount > 3 ? ` +${memberCount - 3}` : ''}
          </p>
        )}
      </div>
      <span className="font-body text-xs text-slate-400 dark:text-white/30 shrink-0 hidden sm:block">
        {memberCount} {isFr ? 'sup.' : 'sup.'}
      </span>
      <div className="flex items-center gap-1 shrink-0">
        <button onClick={() => setEditing(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-navy hover:bg-brand-navy/8 dark:hover:text-white dark:hover:bg-white/10 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button onClick={() => setConfirm(true)} className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-red hover:bg-brand-red/8 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  )
}

// ── User Row ──────────────────────────────────────────────────────────────────
function UserRow({
  user, locale,
  onRoleChange, onResetPassword, onDelete,
}: {
  user:            UserRow
  locale?:         string
  onRoleChange:    (id: string, role: UserRole) => void
  onResetPassword: (id: string) => void
  onDelete:        (id: string) => void
}) {
  const isFr     = locale !== 'en'
  const [role, setRole] = useState<UserRole>(user.role as UserRole)
  const [confirm, setConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  if (confirm) {
    return (
      <div className="flex items-center justify-between gap-3 px-5 py-3 bg-brand-red/5">
        <p className="font-body text-sm text-brand-red">
          {isFr ? `Supprimer ${user.full_name || user.email} ?` : `Delete ${user.full_name || user.email}?`}
        </p>
        <div className="flex gap-2 shrink-0">
          <button onClick={() => setConfirm(false)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors">
            {isFr ? 'Annuler' : 'Cancel'}
          </button>
          <button onClick={() => onDelete(user.id)} className="px-3 h-8 rounded-lg font-body text-xs font-semibold bg-brand-red text-white hover:bg-brand-red/90 transition-colors">
            {isFr ? 'Supprimer' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/60 dark:hover:bg-white/[0.02] transition-colors">
      {/* Avatar initials */}
      <div className="w-8 h-8 rounded-full bg-brand-navy flex items-center justify-center shrink-0">
        <span className="font-body text-[10px] font-bold text-white">
          {(user.full_name || user.email).slice(0, 2).toUpperCase()}
        </span>
      </div>

      {/* Name + email */}
      <div className="flex-1 min-w-0">
        <p className="font-body text-sm font-medium text-slate-800 dark:text-white truncate">
          {user.full_name || '—'}
        </p>
        <p className="font-body text-xs text-slate-400 dark:text-white/30 truncate">{user.email}</p>
      </div>

      {/* Role selector */}
      <select
        value={role}
        onChange={e => {
          const newRole = e.target.value as UserRole
          setRole(newRole)
          onRoleChange(user.id, newRole)
        }}
        className={cn(selectCls, 'w-32 hidden sm:block')}
      >
        {(['admin', 'territory_manager', 'supervisor', 'field_team'] as UserRole[]).map(r => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Reset password */}
        <button
          onClick={() => {
            setResetting(true)
            onResetPassword(user.id)
            setTimeout(() => setResetting(false), 2000)
          }}
          disabled={resetting}
          title={isFr ? 'Réinitialiser le mot de passe' : 'Reset password'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-teal hover:bg-brand-teal/10 disabled:opacity-40 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>
          </svg>
        </button>
        {/* Delete */}
        <button
          onClick={() => setConfirm(true)}
          title={isFr ? 'Supprimer' : 'Delete'}
          className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-brand-red hover:bg-brand-red/8 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
    </div>
  )
}
