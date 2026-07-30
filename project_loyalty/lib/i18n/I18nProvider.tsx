'use client'

import { createContext, useContext, useMemo } from 'react'
import { createTranslator, type Messages, type TranslateFn } from './translate'
import type { Locale } from './config'

type I18nContextValue = { locale: Locale; messages: Messages }

const I18nContext = createContext<I18nContextValue | null>(null)

/**
 * Wraps the app once (in the root layout) with the active locale + its messages,
 * so every client component can translate without prop-drilling. The provider
 * re-renders with fresh messages when the locale changes (router.refresh after
 * the switcher sets the cookie), which also preserves client/in-progress state.
 */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale
  messages: Messages
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext)
  if (!ctx) {
    throw new Error('useTranslations/useLocale must be used within <I18nProvider>')
  }
  return ctx
}

/** Client translator: `const t = useTranslations('namespace')`. */
export function useTranslations(namespace?: string): TranslateFn {
  const { messages } = useI18n()
  return useMemo(() => createTranslator(messages, namespace), [messages, namespace])
}

export function useLocale(): Locale {
  return useI18n().locale
}
