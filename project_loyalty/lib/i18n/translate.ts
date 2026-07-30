/**
 * Tiny translation runtime shared by the server helper and the client hook.
 * Messages are nested JSON; keys are dotted paths ("hero.title"); `{var}`
 * placeholders are interpolated. No dependency, no Turbopack plugin.
 */
export type Messages = Record<string, unknown>

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string

function resolve(messages: Messages, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part]
    return undefined
  }, messages)
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    name in vars ? String(vars[name]) : match,
  )
}

export function createTranslator(messages: Messages, namespace?: string): TranslateFn {
  return (key, vars) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    const value = resolve(messages, fullKey)
    if (typeof value === 'string') return interpolate(value, vars)
    // Missing key: surface it rather than silently rendering nothing. The three
    // message files are kept at full key parity, so this should never show.
    return fullKey
  }
}
