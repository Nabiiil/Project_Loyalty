import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { revalidatePath } from 'next/cache'
import { requireOwner } from '@/lib/staff-owner'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Owner-only business logo upload/removal.
 *
 * POST  multipart form with a `logo` file — validated by magic bytes
 *       (png/jpg/webp), re-encoded server-side with sharp to a ≤512px webp
 *       (a phone photo comes in at 4 MB; what we store is a few KB), uploaded
 *       to the public `business-logos` bucket, then businesses.logo_url is
 *       pointed at it. The previous logo object is deleted afterwards.
 * DELETE removes the current logo and clears businesses.logo_url.
 *
 * Writes go through the service role (storage has no client write policies),
 * so requireOwner() — the caller's own staff_users row — is the security
 * boundary, exactly like the staff-management actions.
 */

const BUCKET = 'business-logos'
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // pre-processing input cap
const MAX_STORED_BYTES = 500 * 1024 // matches the bucket file_size_limit
const OUTPUT_SIZE = 512

function sniffImageType(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length < 12) return null
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'webp'
  }
  return null
}

/**
 * Maps a stored public URL back to its object path inside the bucket, scoped
 * to this business's own folder — never resolves (and thus never deletes)
 * anything outside `${businessId}/`.
 */
function storagePathFromUrl(logoUrl: string | null, businessId: string): string | null {
  if (!logoUrl) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = logoUrl.indexOf(marker)
  if (idx === -1) return null
  const path = decodeURIComponent(logoUrl.slice(idx + marker.length))
  return path.startsWith(`${businessId}/`) ? path : null
}

export async function POST(request: Request) {
  const owner = await requireOwner()
  if (!owner.ok) {
    return NextResponse.json({ ok: false, error: owner.error }, { status: 403 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid upload.' }, { status: 400 })
  }

  const file = form.get('logo')
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, error: 'Choose an image file.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { ok: false, error: 'Image is too large (max 4 MB). Try a smaller photo.' },
      { status: 413 },
    )
  }

  // Never trust the client's content-type — sniff the actual bytes.
  const input = Buffer.from(await file.arrayBuffer())
  if (!sniffImageType(input)) {
    return NextResponse.json(
      { ok: false, error: 'Logo must be a PNG, JPG, or WEBP image.' },
      { status: 415 },
    )
  }

  // Re-encode: EXIF-aware rotate, fit inside 512×512, webp. Stepping down the
  // quality is a fallback that in practice never triggers at this size.
  let processed: Buffer | null = null
  try {
    for (const quality of [82, 65, 45]) {
      const candidate = await sharp(input)
        .rotate()
        .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toBuffer()
      if (candidate.byteLength <= MAX_STORED_BYTES) {
        processed = candidate
        break
      }
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: 'That file could not be read as an image.' },
      { status: 415 },
    )
  }
  if (!processed) {
    return NextResponse.json(
      { ok: false, error: 'Image could not be compressed enough. Try a simpler one.' },
      { status: 413 },
    )
  }

  const service = createServiceClient()

  const { data: business } = await service
    .from('businesses')
    .select('logo_url')
    .eq('id', owner.businessId)
    .single()

  // Timestamped filename: the public URL changes on every upload, so CDN/browser
  // caches of the old logo can never mask the new one.
  const path = `${owner.businessId}/logo-${Date.now()}.webp`
  const { error: uploadError } = await service.storage
    .from(BUCKET)
    .upload(path, processed, { contentType: 'image/webp', cacheControl: '31536000' })
  if (uploadError) {
    console.error('business-logo upload error:', uploadError)
    return NextResponse.json(
      { ok: false, error: 'Could not save the logo. Please try again.' },
      { status: 500 },
    )
  }

  const {
    data: { publicUrl },
  } = service.storage.from(BUCKET).getPublicUrl(path)

  const { error: updateError } = await service
    .from('businesses')
    .update({ logo_url: publicUrl })
    .eq('id', owner.businessId)
  if (updateError) {
    console.error('business-logo update error:', updateError)
    await service.storage.from(BUCKET).remove([path])
    return NextResponse.json(
      { ok: false, error: 'Could not save the logo. Please try again.' },
      { status: 500 },
    )
  }

  // Best-effort cleanup of the replaced object; a leftover file costs nothing
  // and must not fail the upload.
  const oldPath = storagePathFromUrl(business?.logo_url ?? null, owner.businessId)
  if (oldPath && oldPath !== path) {
    await service.storage.from(BUCKET).remove([oldPath])
  }

  revalidatePath('/dashboard')
  revalidatePath('/staff/dashboard/settings')
  return NextResponse.json({ ok: true, logoUrl: publicUrl })
}

export async function DELETE() {
  const owner = await requireOwner()
  if (!owner.ok) {
    return NextResponse.json({ ok: false, error: owner.error }, { status: 403 })
  }

  const service = createServiceClient()

  const { data: business } = await service
    .from('businesses')
    .select('logo_url')
    .eq('id', owner.businessId)
    .single()

  const { error: updateError } = await service
    .from('businesses')
    .update({ logo_url: null })
    .eq('id', owner.businessId)
  if (updateError) {
    console.error('business-logo clear error:', updateError)
    return NextResponse.json(
      { ok: false, error: 'Could not remove the logo. Please try again.' },
      { status: 500 },
    )
  }

  const oldPath = storagePathFromUrl(business?.logo_url ?? null, owner.businessId)
  if (oldPath) {
    await service.storage.from(BUCKET).remove([oldPath])
  }

  revalidatePath('/dashboard')
  revalidatePath('/staff/dashboard/settings')
  return NextResponse.json({ ok: true })
}
