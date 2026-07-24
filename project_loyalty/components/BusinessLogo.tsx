'use client'

import { useState } from 'react'

function initialsFrom(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/**
 * A business's visual mark, used wherever an enrollment/business is listed.
 * Renders the uploaded logo when there is one; otherwise (or if the image
 * fails to load) falls back to the business's initials on a neutral tile —
 * a customer never sees a broken image or a bare identifier.
 */
export function BusinessLogo({
  name,
  logoUrl,
  className = 'h-12 w-12 text-base',
}: {
  name: string
  logoUrl: string | null
  className?: string
}) {
  // Track which URL failed (rather than a bare boolean) so a newly uploaded
  // logo gets a fresh chance without any effect-based reset.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = logoUrl !== null && failedUrl === logoUrl

  if (!logoUrl || failed) {
    return (
      <div
        aria-hidden
        className={`${className} flex shrink-0 select-none items-center justify-center rounded-xl bg-gray-100 font-semibold text-gray-600`}
      >
        {initialsFrom(name)}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- tiny CDN-cached logo at fixed display size; next/image would only add remote-domain config
    <img
      src={logoUrl}
      alt={`${name} logo`}
      loading="lazy"
      onError={() => setFailedUrl(logoUrl)}
      className={`${className} shrink-0 rounded-xl border border-gray-100 bg-white object-cover`}
    />
  )
}
