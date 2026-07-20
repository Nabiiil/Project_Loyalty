'use client'

import { useActionState, useState } from 'react'
import { updateBusinessIdentity } from '../../actions'
import { BusinessLogo } from '@/components/BusinessLogo'

const DEFAULT_ACCENT = '#111827'

/**
 * Big phone photos get downscaled in the browser before upload so the request
 * stays well under the platform body limit; the server route re-validates and
 * re-encodes regardless, so this is purely a transport optimization.
 */
async function downscaleForUpload(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // Safari may hand back PNG instead of WEBP — both are accepted server-side.
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.85),
    )
    return blob ?? file
  } catch {
    // Unreadable in the browser (e.g. exotic format) — let the server decide.
    return file
  }
}

export function IdentityForm({
  initialName,
  initialLogoUrl,
  initialBrandColor,
}: {
  initialName: string
  initialLogoUrl: string | null
  initialBrandColor: string | null
}) {
  const [state, formAction, pending] = useActionState(updateBusinessIdentity, null)

  const [name, setName] = useState(initialName)
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl)
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [useAccent, setUseAccent] = useState(initialBrandColor !== null)
  const [accent, setAccent] = useState(initialBrandColor ?? DEFAULT_ACCENT)

  async function onLogoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow picking the same file again after an error
    if (!file) return

    setLogoError(null)
    setLogoBusy(true)
    try {
      const payload = file.size > 1_500_000 ? await downscaleForUpload(file) : file
      const body = new FormData()
      body.append('logo', payload, file.name || 'logo')
      const res = await fetch('/api/business-logo', { method: 'POST', body })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setLogoError(json?.error ?? 'Upload failed. Please try again.')
        return
      }
      setLogoUrl(json.logoUrl)
    } catch {
      setLogoError('Upload failed. Please try again.')
    } finally {
      setLogoBusy(false)
    }
  }

  async function onLogoRemove() {
    setLogoError(null)
    setLogoBusy(true)
    try {
      const res = await fetch('/api/business-logo', { method: 'DELETE' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setLogoError(json?.error ?? 'Could not remove the logo. Please try again.')
        return
      }
      setLogoUrl(null)
    } catch {
      setLogoError('Could not remove the logo. Please try again.')
    } finally {
      setLogoBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Logo — uploads immediately on selection, independent of the form below. */}
      <div className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Logo
        <span className="text-xs font-normal text-zinc-500">
          Shown on your customers’ stamp cards so they recognize you instantly.
        </span>
        <div className="mt-1 flex items-center gap-4">
          <BusinessLogo name={name || initialName} logoUrl={logoUrl} className="h-16 w-16 text-lg" />
          <label className="flex h-12 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
            {logoBusy ? 'Working…' : logoUrl ? 'Replace logo' : 'Upload logo'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              disabled={logoBusy}
              onChange={onLogoSelected}
            />
          </label>
          {logoUrl && (
            <button
              type="button"
              onClick={onLogoRemove}
              disabled={logoBusy}
              className="text-sm font-medium text-zinc-500 underline disabled:opacity-60"
            >
              Remove
            </button>
          )}
        </div>
        {logoError && (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-red-50 px-4 py-3 text-sm font-normal text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {logoError}
          </p>
        )}
      </div>

      <form action={formAction} className="flex flex-col gap-6">
        {/* Business name */}
        <label className="flex flex-col gap-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Business name
          <span className="text-xs font-normal text-zinc-500">
            How your business appears to customers.
          </span>
          <input
            type="text"
            name="name"
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 h-14 rounded-lg border border-zinc-300 bg-white px-4 text-lg text-black dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
          />
        </label>

        {/* Brand color */}
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
            <input
              type="checkbox"
              checked={useAccent}
              onChange={(e) => setUseAccent(e.target.checked)}
              className="h-5 w-5"
            />
            Use a brand color on customer cards
          </label>
          {useAccent && (
            <label className="flex items-center gap-3 text-sm text-zinc-500">
              <input
                type="color"
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
                className="h-12 w-16 cursor-pointer rounded-lg border border-zinc-300 dark:border-zinc-700"
              />
              Stamps on the customer card use this color.
            </label>
          )}
          {/* '' clears the color server-side when the accent is switched off. */}
          <input type="hidden" name="brand_color" value={useAccent ? accent : ''} />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="h-16 w-full rounded-lg bg-black text-lg font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-black"
        >
          {pending ? 'Saving…' : 'Save identity'}
        </button>

        {state && !state.ok && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {state.error}
          </p>
        )}

        {state && state.ok && (
          <p
            role="status"
            className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 dark:bg-green-950 dark:text-green-300"
          >
            Saved — customers now see “{state.name}”.
          </p>
        )}
      </form>
    </div>
  )
}
