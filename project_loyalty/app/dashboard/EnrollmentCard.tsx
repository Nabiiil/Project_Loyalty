import type { EnrollmentRow } from './page'

export function EnrollmentCard({ enrollment }: { enrollment: EnrollmentRow }) {
  const { current_stamps, businesses } = enrollment
  const name = businesses?.name ?? 'Unknown business'
  const threshold = businesses?.reward_threshold ?? 10
  const rewardReached = current_stamps >= threshold
  const visible = Math.min(threshold, 12)
  const filled = Math.min(current_stamps, visible)
  const cols = visible <= 6 ? visible : 6

  return (
    <div className="rounded-2xl border border-gray-100 p-5 flex flex-col gap-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-widest uppercase text-gray-400">{name}</p>
        {rewardReached && (
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
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
              i < filled ? 'bg-gray-900 border-gray-900' : 'border-gray-200 bg-white',
            ].join(' ')}
          />
        ))}
      </div>

      <p className="text-right text-sm text-gray-400">
        {rewardReached
          ? 'Show to staff to redeem'
          : `${current_stamps} / ${threshold}`}
      </p>
    </div>
  )
}
