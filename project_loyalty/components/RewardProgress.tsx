import type { CSSProperties } from 'react'

/**
 * Customer-facing reward progress — adapts its representation to the reward
 * threshold so a single business card renders correctly at any threshold from
 * 1 to arbitrarily large.
 *
 * - Small thresholds keep the punch-card STAMP GRID: discrete circles, the
 *   better experience at low counts and the mental model customers already have.
 * - Large thresholds switch to a proportional PROGRESS BAR: a filled bar plus
 *   the concrete "137 / 150" fraction, which the grid can't show without either
 *   overflowing or silently capping.
 *
 * Deliberately NOT a `'use client'` module: it holds no state, hooks, or browser
 * APIs, so it renders in both a Server Component parent (the dashboard
 * EnrollmentCard) and a Client Component parent (the scan StampCard) unchanged.
 *
 * The reward description itself is rendered by the surrounding card in both
 * modes (business name/description header on the dashboard, the "toward …" line
 * on the scan page), so the customer always sees the goal — this component only
 * owns the count visualization.
 */

/**
 * Thresholds at or below this stay a stamp grid; above it we render a bar.
 *
 * Placeholder heuristic: magnitude is a proxy for "is this a punch card?".
 * Once a per-amount (points) earning mode exists, prefer switching on the
 * business's `earning_mode` instead — see {@link renderAsStampGrid}. Kept as a
 * single named constant so tuning the cutoff is a one-line change.
 */
export const STAMP_GRID_MAX_THRESHOLD = 12

/**
 * Decides whether to draw the stamp grid (vs. the progress bar).
 *
 * Migration path: when points/`earning_mode` lands, add the mode as a parameter
 * and branch on it first (stamp businesses → grid, points businesses → bar),
 * falling back to the numeric cutoff only when the mode is unknown. Every call
 * site already routes through this one function, so that change stays local.
 */
export function renderAsStampGrid(total: number): boolean {
  return total <= STAMP_GRID_MAX_THRESHOLD
}

/** Neutral fill when a business hasn't set a brand color (gray-900). */
const NEUTRAL_ACCENT = '#111827'

type Size = 'sm' | 'lg'

type RewardProgressProps = {
  /** Stamps earned so far. */
  current: number
  /** Stamps needed for the reward (the reward threshold). */
  total: number
  /**
   * Accessible label for the whole widget, e.g. "3 of 10 stamps". When omitted
   * the widget is treated as decorative (`aria-hidden`) and the parent is
   * expected to expose the count textually instead.
   */
  ariaLabel?: string
  /** Brand accent for filled stamps / the bar fill. Defaults to neutral gray-900. */
  accent?: string
  /** `lg` for the full-screen scan page, `sm` for the compact dashboard card. */
  size?: Size
  className?: string
}

export function RewardProgress({
  current,
  total,
  ariaLabel,
  accent = NEUTRAL_ACCENT,
  size = 'sm',
  className = '',
}: RewardProgressProps) {
  const fillStyle: CSSProperties = { backgroundColor: accent, borderColor: accent }

  if (renderAsStampGrid(total)) {
    return (
      <StampGrid
        current={current}
        total={total}
        fillStyle={fillStyle}
        ariaLabel={ariaLabel}
        size={size}
        className={className}
      />
    )
  }

  return (
    <ProgressBar
      current={current}
      total={total}
      fillStyle={fillStyle}
      ariaLabel={ariaLabel}
      size={size}
      className={className}
    />
  )
}

function StampGrid({
  current,
  total,
  fillStyle,
  ariaLabel,
  size,
  className,
}: {
  current: number
  total: number
  fillStyle: CSSProperties
  ariaLabel?: string
  size: Size
  className: string
}) {
  // total is already <= STAMP_GRID_MAX_THRESHOLD here; Math.min is defensive.
  const visible = Math.min(Math.max(0, total), STAMP_GRID_MAX_THRESHOLD)
  const filled = Math.min(Math.max(0, current), visible)
  // One row up to 6, wrapping to a max of 6 columns beyond that. Guard against
  // repeat(0, …) when a business somehow has a zero threshold.
  const cols = visible <= 6 ? Math.max(1, visible) : 6
  const gap = size === 'lg' ? 'gap-3' : 'gap-2'

  return (
    <div
      className={`grid w-full ${gap} ${className}`}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {Array.from({ length: visible }).map((_, i) => (
        <div
          key={i}
          className={[
            'aspect-square rounded-full border-2',
            i < filled ? '' : 'border-gray-200 bg-white',
          ].join(' ')}
          style={i < filled ? fillStyle : undefined}
        />
      ))}
    </div>
  )
}

function ProgressBar({
  current,
  total,
  fillStyle,
  ariaLabel,
  size,
  className,
}: {
  current: number
  total: number
  fillStyle: CSSProperties
  ariaLabel?: string
  size: Size
  className: string
}) {
  const safeCurrent = Math.max(0, current)
  const pct = total > 0 ? Math.min(100, (safeCurrent / total) * 100) : 0
  const height = size === 'lg' ? 'h-3' : 'h-2.5'

  return (
    <div className={`w-full ${className}`}>
      <div
        className={`relative w-full overflow-hidden rounded-full bg-gray-100 ${height}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={Math.min(safeCurrent, total)}
        aria-label={ariaLabel}
        aria-hidden={ariaLabel ? undefined : true}
      >
        {/* Anchored to the inline-start edge (left in LTR, right in RTL) via the
            logical `start-0` utility, so the bar fills from the correct side
            under Arabic without any direction-specific branching. */}
        <div className="absolute inset-y-0 start-0 rounded-full" style={{ ...fillStyle, width: `${pct}%` }} />
      </div>
    </div>
  )
}
