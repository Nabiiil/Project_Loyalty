import type { EnrollmentRow } from './page'
import { RewardClaim } from './RewardClaim'
import { BusinessLogo } from '@/components/BusinessLogo'

// The DB constrains brand_color to lowercase #rrggbb; re-check before putting
// it in an inline style anyway, and fall back to the neutral stamp color.
const NEUTRAL_ACCENT = '#111827' // gray-900
function safeAccent(raw: string | null | undefined): string {
  return raw && /^#[0-9a-f]{6}$/i.test(raw) ? raw : NEUTRAL_ACCENT
}

export function EnrollmentCard({
  enrollment,
  isClaimed,
}: {
  enrollment: EnrollmentRow
  isClaimed: boolean
}) {
  const { current_stamps, businesses } = enrollment
  const name = businesses?.name ?? 'Unknown business'
  const threshold = businesses?.reward_threshold ?? 10
  const rewardDescription = businesses?.reward_description ?? 'Free item'
  const accent = safeAccent(businesses?.brand_color)
  const rewardReached = current_stamps >= threshold
  const visible = Math.min(threshold, 12)
  const filled = Math.min(current_stamps, visible)
  const cols = visible <= 6 ? visible : 6

  return (
    <div className="rounded-2xl border border-gray-100 p-5 flex flex-col gap-4 shadow-sm">
      {/* Who this card belongs to — logo + name first, so a customer scanning
          their cross-business list recognizes each place instantly. */}
      <div className="flex items-center gap-3">
        <BusinessLogo name={name} logoUrl={businesses?.logo_url ?? null} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-gray-900">{name}</p>
          {/* What the customer is working toward — not just an abstract count. */}
          <p className="truncate text-sm text-gray-500">{rewardDescription}</p>
        </div>
        {rewardReached && (
          <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
            Reward ready
          </span>
        )}
      </div>

      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        aria-label={`${current_stamps} of ${threshold} stamps`}
      >
        {Array.from({ length: visible }).map((_, i) => (
          <div
            key={i}
            className={[
              'aspect-square rounded-full border-2',
              i < filled ? '' : 'border-gray-200 bg-white',
            ].join(' ')}
            style={i < filled ? { backgroundColor: accent, borderColor: accent } : undefined}
          />
        ))}
      </div>

      {rewardReached ? (
        <RewardClaim enrollmentId={enrollment.id} isClaimed={isClaimed} />
      ) : (
        <p className="text-right text-sm text-gray-400">
          {current_stamps} / {threshold}
        </p>
      )}
    </div>
  )
}
