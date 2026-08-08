'use client'

import { useEffect, useRef, useState } from 'react'
import { getStaffClient } from '@/lib/supabase/staff-client'
import { useTranslations } from '@/lib/i18n/I18nProvider'

/** How long we wait for the customer's scan before offering the fallback. */
const CONFIRM_TIMEOUT_MS = 90_000

type Confirmation = {
  currentStamps: number | null
  rewardThreshold: number | null
  /** The customer's chosen name, or null if they haven't set one. */
  displayName: string | null
}

/**
 * Wrap user-supplied text in Unicode isolates (FSI … PDI) before dropping it
 * into a translated sentence — the textual equivalent of `<bdi>`, which we
 * cannot use here because the name is interpolated into a string, not composed
 * from JSX. Without it a Latin name inside the Arabic sentence drags the
 * adjacent "—" and digits to the wrong side.
 */
function isolate(value: string): string {
  return `⁨${value}⁩`
}

type Phase =
  | { kind: 'waiting'; live: boolean } // live=false → socket down, QR still fine
  | { kind: 'confirmed'; result: Confirmation }
  | { kind: 'timeout' }

/**
 * Live scan confirmation for one generated QR. Subscribes to Realtime
 * postgres_changes on this business's transactions (the subscriber's RLS —
 * staff_select_own_business_transactions — is what scopes the stream; another
 * business's events are never delivered) and waits for THIS transaction to flip
 * to 'scanned'. On confirmation it shows the customer's new count and makes the
 * reward-eligible moment loud.
 *
 * Realtime is confirmation only, never a dependency: if the socket drops we
 * show a quiet note and keep waiting (a direct row check still runs at the
 * deadline), and if nothing arrives in ~90s we land on a neutral timeout state
 * that offers the manual-stamp fallback. No permanent spinners.
 */
export function ScanConfirmation({
  transactionId,
  businessId,
  onRequestManual,
}: {
  transactionId: string
  businessId: string
  onRequestManual: () => void
}) {
  const t = useTranslations('scanConfirm')
  const [phase, setPhase] = useState<Phase>({ kind: 'waiting', live: true })
  // The scan can land while the channel is still connecting, and a Realtime
  // event can race the deadline's direct check — resolve exactly once.
  const settled = useRef(false)

  useEffect(() => {
    const supabase = getStaffClient()
    settled.current = false
    // React can mount this effect twice (StrictMode) or remount fast. The topic
    // must be unique PER SUBSCRIBE ATTEMPT: removeChannel() is async, and a new
    // channel reusing a topic that is still leaving never comes up. `cancelled`
    // keeps a torn-down attempt from touching state.
    let cancelled = false
    const topic = `txn-confirm-${transactionId}-${Math.random().toString(36).slice(2)}`

    async function confirm(customerId: string | null) {
      if (settled.current || cancelled) return
      settled.current = true

      // Fetch the new count for the confirmation copy. Both reads are scoped by
      // staff RLS. If they fail, still confirm — the scan itself is certain.
      let result: Confirmation = {
        currentStamps: null,
        rewardThreshold: null,
        displayName: null,
      }
      if (customerId) {
        const [{ data: enrollment }, { data: business }, { data: name }] = await Promise.all([
          supabase
            .from('enrollments')
            .select('current_stamps')
            .eq('customer_id', customerId)
            .eq('business_id', businessId)
            .maybeSingle(),
          supabase
            .from('businesses')
            .select('reward_threshold')
            .eq('id', businessId)
            .maybeSingle(),
          // The ONLY staff-side path to a customer's name. It returns bare text
          // and is scoped by auth.uid() to this staff member's own business, so
          // it cannot reach a rival's customers or any contact detail — see
          // migration 20260808140000. Null means "no name set" and "not yours"
          // alike, and the copy below simply omits the name either way.
          supabase.rpc('get_customer_display_name', { p_customer_id: customerId }),
        ])
        result = {
          currentStamps: enrollment?.current_stamps ?? null,
          rewardThreshold: business?.reward_threshold ?? null,
          displayName: name ?? null,
        }
      }
      setPhase({ kind: 'confirmed', result })
    }

    // Direct row check — the no-realtime path. Used to close the gap between
    // QR creation and channel readiness, and again at the deadline.
    async function checkRow(): Promise<boolean> {
      const { data } = await supabase
        .from('transactions')
        .select('status, customer_id')
        .eq('id', transactionId)
        .maybeSingle()
      if (data?.status === 'scanned') {
        await confirm(data.customer_id)
        return true
      }
      return false
    }

    let channel: ReturnType<typeof supabase.channel> | null = null

    async function openChannel() {
      // The realtime socket does NOT automatically carry the session restored
      // from cookie storage (that wiring only fires on SIGNED_IN /
      // TOKEN_REFRESHED events) — without this the channel joins as `anon`,
      // and RLS then correctly delivers nothing. Hand it the staff JWT
      // explicitly so the subscription registers with the staff claims.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      if (session?.access_token) {
        await supabase.realtime.setAuth(session.access_token)
      }
      if (cancelled) return

      channel = supabase
        .channel(topic)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'transactions',
            // Deliberately NO server-side `filter`: the scoping guarantee is
            // RLS (Realtime only delivers rows this staff session could
            // SELECT, i.e. their own business's transactions — see the
            // realtime_scoping tests), and the Realtime build in the local
            // stack rejects any column filter at registration ("ArgumentError
            // … out of range") while reporting the channel SUBSCRIBED. Volume
            // is one business's own scans; the id match below picks out this
            // transaction.
          },
          (payload) => {
            const row = payload.new as { id?: string; status?: string; customer_id?: string | null }
            if (row.id === transactionId && row.status === 'scanned') {
              void confirm(row.customer_id ?? null)
            }
          },
        )
        .subscribe((status) => {
          if (settled.current || cancelled) return
          if (status === 'SUBSCRIBED') {
            setPhase((p) => (p.kind === 'waiting' ? { kind: 'waiting', live: true } : p))
            void checkRow() // scan may have beaten the subscription
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            // Socket trouble: downgrade the copy, never the QR.
            setPhase((p) => (p.kind === 'waiting' ? { kind: 'waiting', live: false } : p))
          }
        })
    }
    void openChannel()

    const deadline = setTimeout(async () => {
      if (settled.current || cancelled) return
      // Last direct look before declaring a timeout, in case the event was
      // dropped while the socket was flaky.
      const scanned = await checkRow()
      if (!scanned && !settled.current) {
        settled.current = true
        setPhase({ kind: 'timeout' })
      }
    }, CONFIRM_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearTimeout(deadline)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [transactionId, businessId])

  if (phase.kind === 'waiting') {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800"
      >
        <span className="relative flex h-3 w-3 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-zinc-400 opacity-60" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-zinc-400" />
        </span>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t('waiting')}
          {!phase.live && (
            <span className="block text-xs text-zinc-400">{t('liveUnavailable')}</span>
          )}
        </p>
      </div>
    )
  }

  if (phase.kind === 'timeout') {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 px-4 py-4 dark:border-zinc-800">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('timeoutTitle')}</p>
        <p className="text-xs text-zinc-500">{t('timeoutBody')}</p>
        <button
          type="button"
          onClick={onRequestManual}
          className="h-12 rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          {t('addManually')}
        </button>
      </div>
    )
  }

  const { currentStamps, rewardThreshold, displayName } = phase.result
  const eligible =
    currentStamps !== null && rewardThreshold !== null && currentStamps >= rewardThreshold

  // Named and unnamed are separate whole sentences, not a name glued onto a
  // count, so each language controls where the name sits. A customer without a
  // name simply gets the original line — no placeholder, no stray dash.
  const countLine = (key: 'scanned' | 'eligible') =>
    displayName
      ? t(`${key}CountNamed`, {
          name: isolate(displayName),
          current: currentStamps ?? 0,
          total: rewardThreshold ?? 0,
        })
      : t(`${key}Count`, { current: currentStamps ?? 0, total: rewardThreshold ?? 0 })

  if (eligible) {
    // The "one more and it's free" moment — make it unmissable.
    return (
      <div
        role="status"
        className="flex flex-col items-center gap-2 rounded-xl border-2 border-green-500 bg-green-50 px-4 py-6 text-center dark:border-green-600 dark:bg-green-950"
      >
        <span className="text-5xl" aria-hidden>🎉</span>
        <p className="text-xl font-bold text-green-800 dark:text-green-200">{t('eligibleTitle')}</p>
        <p className="text-base font-semibold text-green-700 dark:text-green-300">
          {countLine('eligible')}
        </p>
        <p className="text-xs text-green-700/80 dark:text-green-400">{t('eligibleHint')}</p>
      </div>
    )
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-green-300 bg-green-50 px-4 py-3 dark:border-green-800 dark:bg-green-950"
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-600 text-lg font-bold text-white"
        aria-hidden
      >
        ✓
      </span>
      <p className="text-sm text-green-800 dark:text-green-300">
        <span className="font-semibold">{t('scannedTitle')}</span>
        {currentStamps !== null && rewardThreshold !== null && (
          <span className="block">{countLine('scanned')}</span>
        )}
      </p>
    </div>
  )
}
