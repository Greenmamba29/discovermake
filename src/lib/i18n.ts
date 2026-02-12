/**
 * DiscoverMake Internationalization Configuration
 * Supports 27 languages for global deployment
 */

// Supported locales with their display names
export const SUPPORTED_LOCALES = {
    en: { name: 'English', flag: '🇺🇸', dir: 'ltr' },
    es: { name: 'Español', flag: '🇪🇸', dir: 'ltr' },
    fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr' },
    de: { name: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
    it: { name: 'Italiano', flag: '🇮🇹', dir: 'ltr' },
    pt: { name: 'Português', flag: '🇧🇷', dir: 'ltr' },
    nl: { name: 'Nederlands', flag: '🇳🇱', dir: 'ltr' },
    pl: { name: 'Polski', flag: '🇵🇱', dir: 'ltr' },
    ru: { name: 'Русский', flag: '🇷🇺', dir: 'ltr' },
    uk: { name: 'Українська', flag: '🇺🇦', dir: 'ltr' },
    ja: { name: '日本語', flag: '🇯🇵', dir: 'ltr' },
    ko: { name: '한국어', flag: '🇰🇷', dir: 'ltr' },
    zh: { name: '中文', flag: '🇨🇳', dir: 'ltr' },
    'zh-TW': { name: '繁體中文', flag: '🇹🇼', dir: 'ltr' },
    ar: { name: 'العربية', flag: '🇸🇦', dir: 'rtl' },
    he: { name: 'עברית', flag: '🇮🇱', dir: 'rtl' },
    hi: { name: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
    th: { name: 'ไทย', flag: '🇹🇭', dir: 'ltr' },
    vi: { name: 'Tiếng Việt', flag: '🇻🇳', dir: 'ltr' },
    id: { name: 'Bahasa Indonesia', flag: '🇮🇩', dir: 'ltr' },
    ms: { name: 'Bahasa Melayu', flag: '🇲🇾', dir: 'ltr' },
    tr: { name: 'Türkçe', flag: '🇹🇷', dir: 'ltr' },
    sv: { name: 'Svenska', flag: '🇸🇪', dir: 'ltr' },
    no: { name: 'Norsk', flag: '🇳🇴', dir: 'ltr' },
    da: { name: 'Dansk', flag: '🇩🇰', dir: 'ltr' },
    fi: { name: 'Suomi', flag: '🇫🇮', dir: 'ltr' },
    cs: { name: 'Čeština', flag: '🇨🇿', dir: 'ltr' },
} as const;

export type SupportedLocale = keyof typeof SUPPORTED_LOCALES;
export const DEFAULT_LOCALE: SupportedLocale = 'en';

// Core translation keys
export interface TranslationKeys {
    // Navigation
    'nav.marketplace': string;
    'nav.makers': string;
    'nav.pricing': string;
    'nav.docs': string;
    'nav.connect': string;

    // Landing Page
    'hero.discover': string;
    'hero.build': string;
    'hero.make': string;
    'hero.tagline': string;
    'hero.cta.seekers': string;
    'hero.cta.makers': string;

    // Seeker Flow
    'seeker.dashboard.title': string;
    'seeker.projects.active': string;
    'seeker.projects.create': string;
    'seeker.ai.describe': string;

    // Maker Flow
    'maker.dashboard.title': string;
    'maker.gigs.available': string;
    'maker.earnings.total': string;
    'maker.ai.autopilot': string;

    // Common
    'common.loading': string;
    'common.error': string;
    'common.success': string;
    'common.cancel': string;
    'common.submit': string;
    'common.save': string;
}

// English translations (default)
const en: TranslationKeys = {
    'nav.marketplace': 'Marketplace',
    'nav.makers': 'Makers',
    'nav.pricing': 'Pricing',
    'nav.docs': 'Docs',
    'nav.connect': 'Connect Hub',

    'hero.discover': 'DISCOVER+',
    'hero.build': 'BUILD+',
    'hero.make': 'MAKE+',
    'hero.tagline': 'The autonomous software refinery for the next millennium.',
    'hero.cta.seekers': 'I Need Software',
    'hero.cta.makers': 'I Build Software',

    'seeker.dashboard.title': 'Mission Control',
    'seeker.projects.active': 'Active Projects',
    'seeker.projects.create': 'New Mission',
    'seeker.ai.describe': 'Describe your software vision...',

    'maker.dashboard.title': 'Developer Hub',
    'maker.gigs.available': 'Available Gigs',
    'maker.earnings.total': 'Total Earnings',
    'maker.ai.autopilot': 'Enable AI Autopilot',

    'common.loading': 'Loading...',
    'common.error': 'An error occurred',
    'common.success': 'Success!',
    'common.cancel': 'Cancel',
    'common.submit': 'Submit',
    'common.save': 'Save',
};

// Translation storage
const translations: Record<SupportedLocale, Partial<TranslationKeys>> = {
    en,
    es: {
        'nav.marketplace': 'Mercado',
        'nav.makers': 'Creadores',
        'nav.pricing': 'Precios',
        'nav.docs': 'Documentación',
        'nav.connect': 'Centro de Conexión',
        'hero.discover': 'DESCUBRE+',
        'hero.build': 'CONSTRUYE+',
        'hero.make': 'CREA+',
        'hero.tagline': 'La refinería de software autónoma para el próximo milenio.',
        'hero.cta.seekers': 'Necesito Software',
        'hero.cta.makers': 'Yo Construyo Software',
        'common.loading': 'Cargando...',
        'common.error': 'Ocurrió un error',
        'common.success': '¡Éxito!',
        'common.cancel': 'Cancelar',
        'common.submit': 'Enviar',
        'common.save': 'Guardar',
    },
    fr: {
        'nav.marketplace': 'Marché',
        'nav.makers': 'Créateurs',
        'nav.pricing': 'Tarifs',
        'nav.docs': 'Documentation',
        'nav.connect': 'Hub de Connexion',
        'hero.discover': 'DÉCOUVRIR+',
        'hero.build': 'CONSTRUIRE+',
        'hero.make': 'CRÉER+',
        'hero.tagline': 'La raffinerie logicielle autonome pour le prochain millénaire.',
        'hero.cta.seekers': "J'ai Besoin de Logiciel",
        'hero.cta.makers': 'Je Développe',
        'common.loading': 'Chargement...',
        'common.cancel': 'Annuler',
        'common.submit': 'Soumettre',
        'common.save': 'Sauvegarder',
    },
    de: {
        'nav.marketplace': 'Marktplatz',
        'nav.makers': 'Entwickler',
        'nav.pricing': 'Preise',
        'nav.docs': 'Dokumentation',
        'hero.discover': 'ENTDECKEN+',
        'hero.build': 'BAUEN+',
        'hero.make': 'MACHEN+',
        'hero.tagline': 'Die autonome Software-Raffinerie für das nächste Jahrtausend.',
        'hero.cta.seekers': 'Ich Brauche Software',
        'hero.cta.makers': 'Ich Entwickle Software',
    },
    // Stubs for remaining languages (to be expanded)
    it: {}, pt: {}, nl: {}, pl: {}, ru: {}, uk: {},
    ja: {}, ko: {}, zh: {}, 'zh-TW': {}, ar: {}, he: {},
    hi: {}, th: {}, vi: {}, id: {}, ms: {}, tr: {},
    sv: {}, no: {}, da: {}, fi: {}, cs: {},
};

// Current locale state
let currentLocale: SupportedLocale = DEFAULT_LOCALE;

/**
 * Set the active locale
 */
export function setLocale(locale: SupportedLocale): void {
    if (SUPPORTED_LOCALES[locale]) {
        currentLocale = locale;
        // Update document direction for RTL languages
        if (typeof document !== 'undefined') {
            document.documentElement.dir = SUPPORTED_LOCALES[locale].dir;
            document.documentElement.lang = locale;
        }
    }
}

/**
 * Get the current locale
 */
export function getLocale(): SupportedLocale {
    return currentLocale;
}

/**
 * Translate a key to the current locale
 * Falls back to English if translation is missing
 */
export function t(key: keyof TranslationKeys): string {
    const localeTranslations = translations[currentLocale];
    return localeTranslations[key] ?? en[key] ?? key;
}

/**
 * Detect user's preferred locale from browser
 */
export function detectLocale(): SupportedLocale {
    if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

    const browserLang = navigator.language.split('-')[0] as SupportedLocale;
    return SUPPORTED_LOCALES[browserLang] ? browserLang : DEFAULT_LOCALE;
}

/**
 * Format a number according to locale
 */
export function formatNumber(value: number): string {
    return new Intl.NumberFormat(currentLocale).format(value);
}

/**
 * Format currency according to locale
 */
export function formatCurrency(value: number, currency = 'USD'): string {
    return new Intl.NumberFormat(currentLocale, {
        style: 'currency',
        currency,
    }).format(value);
}

/**
 * Format a date according to locale
 */
export function formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(currentLocale, options).format(date);
}
