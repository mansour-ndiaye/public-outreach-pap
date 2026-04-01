// Routing constants shared between middleware (Edge) and server code.
// This file must NOT import from 'next-intl/server' or any Node.js module.
export const locales = ['fr', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'fr'
