import { getTranslations, getLocale } from '@/lib/i18n/server'
import type { Locale } from '@/lib/i18n/config'

/**
 * New vs returning customers over time — a stacked daily bar (new on the
 * bottom, returning on top). Server-rendered inline SVG: no client JS, per the
 * PWA "minimal JS on old tablets" constraint. Per-day detail is available on
 * hover via a native SVG <title>; identity is carried by the legend (never
 * color alone). The time axis stays left→right (dir=ltr) in every locale so the
 * bar order and the date endpoints always agree; digits are Western everywhere.
 */

export type DayPoint = { day: string; new: number; returning: number }

const W = 600
const H = 180
const PAD_TOP = 8
const PAD_BOTTOM = 26
const BASE_Y = H - PAD_BOTTOM
const PLOT_H = BASE_Y - PAD_TOP

function fmtDay(iso: string, locale: Locale): string {
  // Parse the YYYY-MM-DD as a plain date (no timezone shift); Western digits.
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(`${locale}-u-nu-latn`, {
    month: 'short',
    day: 'numeric',
  })
}

export async function NewVsReturningChart({ series }: { series: DayPoint[] }) {
  const t = await getTranslations('analytics')
  const locale = await getLocale()

  const maxTotal = Math.max(1, ...series.map((p) => p.new + p.returning))
  const n = series.length
  const slot = W / Math.max(1, n)
  const barW = Math.max(1.5, Math.min(slot - 2, 16))
  const totalNew = series.reduce((s, p) => s + p.new, 0)
  const totalReturning = series.reduce((s, p) => s + p.returning, 0)

  return (
    <div className="viz flex flex-col gap-3">
      <style>{`
        .viz {
          --series-new: #2a78d6;
          --series-ret: #008300;
          --viz-axis: #c3c2b7;
        }
        @media (prefers-color-scheme: dark) {
          .viz { --series-new: #3987e5; --series-ret: #008300; --viz-axis: #383835; }
        }
      `}</style>

      {/* Legend — identity is never color-alone. */}
      <div className="flex items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-new)' }} />
          {t('chartNew', { count: totalNew })}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--series-ret)' }} />
          {t('chartReturning', { count: totalReturning })}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={t('chartAria', { new: totalNew, returning: totalReturning, days: n })}
        preserveAspectRatio="none"
        className="h-44 w-full"
      >
        {/* Baseline */}
        <line x1={0} y1={BASE_Y} x2={W} y2={BASE_Y} stroke="var(--viz-axis)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        {series.map((p, i) => {
          const cx = i * slot + slot / 2
          const x = cx - barW / 2
          const newH = (p.new / maxTotal) * PLOT_H
          const retH = (p.returning / maxTotal) * PLOT_H
          const gap = retH > 0 && newH > 0 ? 2 : 0
          const newY = BASE_Y - newH
          const retY = newY - gap - retH
          const topIsReturning = retH > 0
          return (
            <g key={p.day}>
              {newH > 0 && (
                <rect
                  x={x}
                  y={newY}
                  width={barW}
                  height={newH}
                  rx={topIsReturning ? 0 : Math.min(2, barW / 2)}
                  fill="var(--series-new)"
                />
              )}
              {retH > 0 && (
                <rect
                  x={x}
                  y={retY}
                  width={barW}
                  height={retH}
                  rx={Math.min(2, barW / 2)}
                  fill="var(--series-ret)"
                />
              )}
              <rect x={i * slot} y={PAD_TOP} width={slot} height={PLOT_H} fill="transparent">
                <title>
                  {t('chartTooltip', { day: fmtDay(p.day, locale), new: p.new, returning: p.returning })}
                </title>
              </rect>
            </g>
          )
        })}
      </svg>

      {/* x-axis endpoints only — locked LTR to match the bar order. */}
      {n > 0 && (
        <div className="flex justify-between text-[11px] text-zinc-400" style={{ marginTop: -8 }} dir="ltr">
          <span>{fmtDay(series[0].day, locale)}</span>
          <span>{fmtDay(series[n - 1].day, locale)}</span>
        </div>
      )}
    </div>
  )
}
