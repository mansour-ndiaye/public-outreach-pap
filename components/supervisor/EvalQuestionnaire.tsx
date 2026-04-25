'use client'

import { useState, useRef, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { submitEval } from '@/lib/supabase/eval-actions'

const EVAL_DAYS = ['D1', 'D2', 'D3', 'D4', 'D5'] as const

type SpeechRecognitionType = {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend:   (() => void) | null
}

interface Props {
  eodEntryId:     string | null
  supervisorId:   string
  supervisorName: string
  teamId:         string
  teamName:       string
  evalDate:       string
  locale?:        string
  onComplete:     () => void
}

export default function EvalQuestionnaire({
  eodEntryId, supervisorId, supervisorName, teamId, teamName, evalDate, locale, onComplete,
}: Props) {
  const t   = useTranslations('evals')
  const isFr = locale !== 'en'

  const [step, setStep]               = useState<'prompt' | 'form'>('prompt')
  const [evalDay,        setEvalDay]        = useState('')
  const [evalName,       setEvalName]       = useState('')
  const [coachedSelf,    setCoachedSelf]    = useState<boolean | null>(null)
  const [coachName,      setCoachName]      = useState('')
  const [evalPphInput,   setEvalPphInput]   = useState('')
  const [evalHours,      setEvalHours]      = useState('')
  const [evalPac,        setEvalPac]        = useState('')
  const [notes,          setNotes]          = useState('')
  const [submitting,     setSubmitting]     = useState(false)
  const [formError,      setFormError]      = useState('')
  const [isRecording,    setIsRecording]    = useState(false)
  const recognitionRef = useRef<SpeechRecognitionType | null>(null)

  // Auto-compute PPH from hours + PAC when both filled
  const computedPph = (() => {
    const h = parseFloat(evalHours)
    const p = parseFloat(evalPac)
    if (h > 0 && p > 0) return (p / h).toFixed(2)
    return null
  })()

  const displayPph = computedPph ?? evalPphInput

  const toggleVoice = useCallback(() => {
    if (typeof window === 'undefined') return
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionType; webkitSpeechRecognition?: new () => SpeechRecognitionType }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionType }).webkitSpeechRecognition
    if (!SR) return
    if (isRecording) { recognitionRef.current?.stop(); setIsRecording(false); return }
    const rec = new SR()
    rec.lang = 'fr-CA'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = e => setNotes(prev => prev ? prev + ' ' + e.results[0][0].transcript : e.results[0][0].transcript)
    rec.onerror = () => setIsRecording(false)
    rec.onend   = () => setIsRecording(false)
    recognitionRef.current = rec
    rec.start()
    setIsRecording(true)
  }, [isRecording])

  const handleSubmit = async () => {
    if (!evalDay)              { setFormError(isFr ? 'Sélectionnez un jour d\'évaluation' : 'Select an eval day'); return }
    if (!evalName.trim())      { setFormError(isFr ? 'Entrez le nom de la recrue' : 'Enter recruit name'); return }
    if (coachedSelf === null)  { setFormError(isFr ? 'Indiquez qui a coaché' : 'Indicate who coached'); return }
    if (!coachedSelf && !coachName.trim()) { setFormError(isFr ? 'Entrez le nom du coach' : 'Enter coach name'); return }
    const pph = parseFloat(computedPph ?? evalPphInput)
    if (isNaN(pph) || pph <= 0) { setFormError(isFr ? 'Entrez un PPH valide' : 'Enter a valid PPH'); return }

    setSubmitting(true)
    setFormError('')
    const result = await submitEval({
      eod_entry_id:          eodEntryId,
      supervisor_id:         supervisorId,
      supervisor_name:       supervisorName,
      team_id:               teamId,
      team_name:             teamName,
      eval_date:             evalDate,
      eval_day:              evalDay,
      eval_name:             evalName.trim(),
      coached_by_supervisor: coachedSelf,
      coach_name:            coachedSelf ? null : coachName.trim() || null,
      eval_pph:              pph,
      eval_canvas_hours:     evalHours ? parseFloat(evalHours) : null,
      eval_pac_total:        evalPac ? parseFloat(evalPac) : null,
      notes:                 notes.trim() || null,
    })
    setSubmitting(false)
    if (result.error) { setFormError(result.error); return }
    onComplete()
  }

  const inputCls = cn(
    'w-full rounded-xl px-4 py-3 font-body text-sm',
    'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
    'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
    'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
    'transition-[border-color,box-shadow] duration-200',
  )

  // ── Prompt step ───────────────────────────────────────────────────────────
  if (step === 'prompt') {
    return (
      <div className={cn(
        'rounded-2xl border border-brand-navy/20 dark:border-white/[0.10]',
        'bg-white dark:bg-[#12163a] p-6 space-y-4',
      )}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-navy/10 dark:bg-white/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-brand-navy dark:text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>
            </svg>
          </div>
          <p className="font-display text-base font-bold text-brand-navy dark:text-white">
            {t('prompt_title')}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setStep('form')}
            className="flex-1 h-11 rounded-xl font-body text-sm font-semibold bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
          >
            {t('prompt_yes')}
          </button>
          <button
            onClick={onComplete}
            className="flex-1 h-11 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.05] transition-colors"
          >
            {t('prompt_no')}
          </button>
        </div>
      </div>
    )
  }

  // ── Form step ─────────────────────────────────────────────────────────────
  return (
    <div className={cn(
      'rounded-2xl border border-brand-navy/20 dark:border-white/[0.10]',
      'bg-white dark:bg-[#12163a] p-6 space-y-5',
    )}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-brand-navy/10 dark:bg-white/10 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-brand-navy dark:text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z"/>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"/>
          </svg>
        </div>
        <div>
          <p className="font-display text-base font-bold text-brand-navy dark:text-white">{t('form_title')}</p>
          <p className="font-body text-xs text-slate-500 dark:text-white/40">{evalDate}</p>
        </div>
      </div>

      {formError && (
        <div className="rounded-xl px-4 py-3 bg-brand-red/10 border border-brand-red/30 text-brand-red font-body text-sm">
          {formError}
        </div>
      )}

      {/* 1. Eval Day */}
      <div>
        <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
          {t('eval_day')} <span className="text-brand-red">*</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          {EVAL_DAYS.map(day => {
            const label = isFr ? t(`days.${day}`) : day
            return (
              <button
                key={day}
                type="button"
                onClick={() => setEvalDay(day)}
                className={cn(
                  'px-4 py-2 rounded-xl font-body text-sm font-semibold border transition-all',
                  evalDay === day
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-brand-navy/40',
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {/* 2. Eval Name */}
      <div>
        <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
          {t('eval_name')} <span className="text-brand-red">*</span>
        </label>
        <input
          type="text"
          value={evalName}
          onChange={e => setEvalName(e.target.value)}
          placeholder={t('eval_name_placeholder')}
          className={inputCls}
        />
      </div>

      {/* 3. Coached by self? */}
      <div>
        <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
          {t('coached_self')} <span className="text-brand-red">*</span>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setCoachedSelf(true)}
            className={cn(
              'flex-1 h-10 rounded-xl font-body text-sm font-semibold border transition-all',
              coachedSelf === true
                ? 'bg-brand-teal text-white border-brand-teal'
                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-brand-teal/40',
            )}
          >
            {t('coached_yes')}
          </button>
          <button
            type="button"
            onClick={() => setCoachedSelf(false)}
            className={cn(
              'flex-1 h-10 rounded-xl font-body text-sm font-semibold border transition-all',
              coachedSelf === false
                ? 'bg-brand-teal text-white border-brand-teal'
                : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:border-brand-teal/40',
            )}
          >
            {t('coached_no')}
          </button>
        </div>
        {coachedSelf === false && (
          <input
            type="text"
            value={coachName}
            onChange={e => setCoachName(e.target.value)}
            placeholder={t('coach_name_placeholder')}
            className={cn(inputCls, 'mt-2')}
          />
        )}
      </div>

      {/* 4–6. PPH / Hours / PAC */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
            {t('eval_canvas_hours')}
          </label>
          <input
            type="number" step="0.25" min="0"
            value={evalHours}
            onChange={e => setEvalHours(e.target.value)}
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
            {t('eval_pac_total')}
          </label>
          <input
            type="number" step="0.01" min="0"
            value={evalPac}
            onChange={e => setEvalPac(e.target.value)}
            placeholder="0"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
            {t('eval_pph')} <span className="text-brand-red">*</span>
            {computedPph && (
              <span className="ml-1 text-brand-teal normal-case font-normal">({t('auto_pph')})</span>
            )}
          </label>
          <input
            type="number" step="0.01" min="0"
            value={computedPph ?? evalPphInput}
            onChange={e => { if (!computedPph) setEvalPphInput(e.target.value) }}
            readOnly={!!computedPph}
            placeholder="0"
            className={cn(inputCls, computedPph && 'bg-brand-teal/5 dark:bg-brand-teal/10 font-semibold text-brand-teal')}
          />
        </div>
      </div>

      {/* 7. Notes + voice */}
      <div>
        <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
          {t('notes')}
        </label>
        <div className="flex gap-2">
          <textarea
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t('notes_placeholder')}
            className={cn(inputCls, 'resize-none flex-1')}
          />
          <button
            type="button"
            onClick={toggleVoice}
            aria-label={isFr ? 'Dictée vocale' : 'Voice input'}
            className={cn(
              'w-10 self-start mt-0 rounded-xl flex items-center justify-center h-10 shrink-0',
              isRecording
                ? 'bg-brand-red text-white animate-pulse'
                : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-white/50',
              'transition-colors',
            )}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={onComplete}
          disabled={submitting}
          className="flex-1 h-11 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/10 text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05] disabled:opacity-50 transition-colors"
        >
          {t('skip')}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="flex-[2] h-11 rounded-xl font-body text-sm font-semibold bg-brand-navy text-white hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              {t('submitting')}
            </span>
          ) : t('submit')}
        </button>
      </div>
    </div>
  )
}
