export const locales = ['en', 'es', 'fr', 'de', 'ar'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'en'

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  de: 'DE',
  ar: 'AR (preview)',
}
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  ar: 'Arabic (RTL preview)',
}

export const LOCALE_DIRECTIONS: Record<Locale, 'ltr' | 'rtl'> = {
  en: 'ltr',
  es: 'ltr',
  fr: 'ltr',
  de: 'ltr',
  ar: 'rtl',
}
