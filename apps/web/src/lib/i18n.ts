import type { Locale } from '../middleware'

// ---------------------------------------------------------------------------
// Message catalogue — add keys here, translate in each locale object
// ---------------------------------------------------------------------------
const messages = {
  en: {
    'home.title': 'SolarProof',
    'home.tagline': 'End-to-end cryptographic proof of renewable energy on Stellar.',
    'home.subtitle': 'Every kWh signed at the meter · anchored on-chain · publicly verifiable',
    'home.verify_cta': 'Verify a Certificate',
    'home.dashboard_cta': 'Dashboard',
    'home.chain_title': 'Chain of custody',
    'nav.verify': 'Verify',
    'nav.dashboard': 'Dashboard',
    'verify.title': 'Verify Certificate',
    'verify.placeholder': 'Certificate ID or transaction hash',
    'verify.submit': 'Verify',
    'error.not_found': 'Not found',
    'error.invalid_signature': 'Invalid signature',
  },
  es: {
    'home.title': 'SolarProof',
    'home.tagline': 'Prueba criptográfica de extremo a extremo de energía renovable en Stellar.',
    'home.subtitle': 'Cada kWh firmado en el medidor · anclado en cadena · verificable públicamente',
    'home.verify_cta': 'Verificar certificado',
    'home.dashboard_cta': 'Panel',
    'home.chain_title': 'Cadena de custodia',
    'nav.verify': 'Verificar',
    'nav.dashboard': 'Panel',
    'verify.title': 'Verificar certificado',
    'verify.placeholder': 'ID de certificado o hash de transacción',
    'verify.submit': 'Verificar',
    'error.not_found': 'No encontrado',
    'error.invalid_signature': 'Firma no válida',
  },
  fr: {
    'home.title': 'SolarProof',
    'home.tagline': 'Preuve cryptographique de bout en bout de l\'énergie renouvelable sur Stellar.',
    'home.subtitle': 'Chaque kWh signé au compteur · ancré on-chain · vérifiable publiquement',
    'home.verify_cta': 'Vérifier un certificat',
    'home.dashboard_cta': 'Tableau de bord',
    'home.chain_title': 'Chaîne de custody',
    'nav.verify': 'Vérifier',
    'nav.dashboard': 'Tableau de bord',
    'verify.title': 'Vérifier le certificat',
    'verify.placeholder': 'ID de certificat ou hash de transaction',
    'verify.submit': 'Vérifier',
    'error.not_found': 'Introuvable',
    'error.invalid_signature': 'Signature invalide',
  },
  de: {
    'home.title': 'SolarProof',
    'home.tagline': 'Ende-zu-Ende-kryptografischer Nachweis erneuerbarer Energie auf Stellar.',
    'home.subtitle': 'Jede kWh am Zähler signiert · on-chain verankert · öffentlich prüfbar',
    'home.verify_cta': 'Zertifikat prüfen',
    'home.dashboard_cta': 'Dashboard',
    'home.chain_title': 'Herkunftsnachweis',
    'nav.verify': 'Prüfen',
    'nav.dashboard': 'Dashboard',
    'verify.title': 'Zertifikat prüfen',
    'verify.placeholder': 'Zertifikats-ID oder Transaktions-Hash',
    'verify.submit': 'Prüfen',
    'error.not_found': 'Nicht gefunden',
    'error.invalid_signature': 'Ungültige Signatur',
  },
  pt: {
    'home.title': 'SolarProof',
    'home.tagline': 'Prova criptográfica ponta a ponta de energia renovável no Stellar.',
    'home.subtitle': 'Cada kWh assinado no medidor · ancorado on-chain · verificável publicamente',
    'home.verify_cta': 'Verificar certificado',
    'home.dashboard_cta': 'Painel',
    'home.chain_title': 'Cadeia de custódia',
    'nav.verify': 'Verificar',
    'nav.dashboard': 'Painel',
    'verify.title': 'Verificar certificado',
    'verify.placeholder': 'ID de certificado ou hash de transação',
    'verify.submit': 'Verificar',
    'error.not_found': 'Não encontrado',
    'error.invalid_signature': 'Assinatura inválida',
  },
  ar: {},
} satisfies Record<Locale, Record<string, string>>

export type MessageKey = keyof typeof messages['en']

/**
 * Returns a translate function for the given locale.
 * Falls back to English if the key is missing in the requested locale.
 */
export function getTranslations(locale: Locale) {
  return function t(key: MessageKey): string {
    return (messages[locale] as Record<string, string> | undefined)?.[key] ?? messages['en'][key] ?? key
  }
}
