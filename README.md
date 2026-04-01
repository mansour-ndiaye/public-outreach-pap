# Public Outreach — PAP Territory Management

A modern, mobile-first web application for managing field territories (terrains) for Public Outreach field teams. Replaces Google My Maps with a purpose-built, role-aware map platform.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Database & Auth | Supabase |
| Maps | Mapbox GL JS |
| i18n | next-intl (FR default, EN) |
| Dark/Light mode | next-themes |
| Hosting | Vercel |

---

## Folder Structure

```
/
├── app/
│   ├── layout.tsx              # Root HTML shell
│   ├── globals.css             # Global styles + Tailwind imports
│   └── [locale]/               # Locale-prefixed routes (fr / en)
│       ├── layout.tsx          # ThemeProvider + NextIntlClientProvider
│       ├── page.tsx            # Landing / Login page
│       └── dashboard/          # Protected dashboard (next phase)
│           └── page.tsx
│
├── components/
│   ├── auth/
│   │   └── LoginForm.tsx       # Email/password login form (Supabase)
│   ├── ui/
│   │   ├── ThemeToggle.tsx     # Dark / Light mode button
│   │   └── LocaleToggle.tsx    # FR / EN language switcher
│   └── providers/
│       └── ThemeProvider.tsx   # next-themes wrapper
│
├── lib/
│   ├── supabase/
│   │   ├── client.ts           # Browser Supabase client
│   │   └── server.ts           # Server-side Supabase client (RSC / actions)
│   └── utils.ts                # cn() helper (clsx + tailwind-merge)
│
├── hooks/                      # Custom React hooks (future)
│
├── types/
│   ├── index.ts                # Shared TypeScript types
│   └── database.ts             # Supabase database schema types
│
├── messages/
│   ├── fr.json                 # French translations (default)
│   └── en.json                 # English translations
│
├── public/
│   └── assets/
│       ├── logo.jpeg           # PO logo mark
│       └── banner.jpeg         # PO banner / wordmark
│
├── i18n.ts                     # next-intl config + locale list
├── middleware.ts               # next-intl locale routing middleware
├── next.config.js              # Next.js config (next-intl plugin)
├── tailwind.config.ts          # Brand colors, fonts, shadows, animations
├── tsconfig.json
├── postcss.config.js
├── .env.local.example          # Environment variable template
└── .gitignore
```

---

## Getting Started

### 1. Install Node.js

Download from [nodejs.org](https://nodejs.org) (v18+ recommended, v20+ ideal).

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in your Supabase and Mapbox credentials in `.env.local`.

### 4. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/fr` (default locale).

---

## Environment Variables

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Mapbox Account → Tokens |

---

## Brand Colors

| Name | Hex |
|---|---|
| Dark Navy | `#2E3192` |
| Red / Pink | `#E8174B` |
| Teal / Mint | `#00B5A3` |
| White | `#FFFFFF` |

Available in Tailwind as `brand-navy`, `brand-red`, `brand-teal`.

---

## User Roles

| Role | Key |
|---|---|
| Administrator | `admin` |
| Territory Manager | `territory_manager` |
| Supervisor | `supervisor` |
| Field Team | `field_team` |

---

## i18n

- Default locale: **French** (`/fr`)
- Supported: `fr`, `en`
- All UI strings live in `messages/fr.json` and `messages/en.json`
- The FR/EN toggle is visible on every page

---

## Dark / Light Mode

- Defaults to **dark mode**
- Persisted via `next-themes` (class strategy on `<html>`)
- Toggle available on every page (top-right)

---

## Roadmap (Phases)

- [x] **Phase 1** — Foundation (this PR): project setup, auth, i18n, theme, login page
- [ ] **Phase 2** — Dashboard shell + navigation
- [ ] **Phase 3** — Mapbox territory map
- [ ] **Phase 4** — Terrain CRUD (create, assign, edit polygons)
- [ ] **Phase 5** — Role-based access control
- [ ] **Phase 6** — Reports & exports
