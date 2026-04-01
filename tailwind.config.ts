import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Public Outreach brand palette
        brand: {
          navy:  '#2E3192',
          'navy-dark':  '#1e2170',
          'navy-light': '#3d42b8',
          red:   '#E8174B',
          'red-dark':   '#c4103a',
          'red-light':  '#ff2d5e',
          teal:  '#00B5A3',
          'teal-dark':  '#008f80',
          'teal-light': '#00d4bf',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        body:    ['var(--font-body)', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        tight: '-0.03em',
      },
      lineHeight: {
        relaxed: '1.7',
      },
      boxShadow: {
        'navy-sm':  '0 2px 8px rgba(46,49,146,0.15), 0 1px 3px rgba(46,49,146,0.1)',
        'navy-md':  '0 4px 20px rgba(46,49,146,0.2), 0 2px 8px rgba(46,49,146,0.12)',
        'navy-lg':  '0 8px 40px rgba(46,49,146,0.25), 0 4px 16px rgba(46,49,146,0.15)',
        'red-sm':   '0 2px 8px rgba(232,23,75,0.2)',
        'red-md':   '0 4px 20px rgba(232,23,75,0.3)',
        'teal-sm':  '0 2px 8px rgba(0,181,163,0.2)',
        'card':     '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.08)',
        'card-dark':'0 1px 3px rgba(0,0,0,0.3),  0 4px 16px rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'noise': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='200' height='200' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
        'gradient-navy': 'radial-gradient(ellipse 80% 60% at 20% 20%, rgba(46,49,146,0.18) 0%, transparent 60%), radial-gradient(ellipse 60% 80% at 80% 80%, rgba(0,181,163,0.12) 0%, transparent 60%)',
        'gradient-dark':  'radial-gradient(ellipse 80% 60% at 20% 0%,   rgba(46,49,146,0.4)  0%, transparent 60%), radial-gradient(ellipse 60% 80% at 80% 100%, rgba(0,181,163,0.15) 0%, transparent 60%)',
      },
      animation: {
        'fade-in':    'fadeIn 0.4s cubic-bezier(0.16,1,0.3,1)',
        'slide-up':   'slideUp 0.5s cubic-bezier(0.16,1,0.3,1)',
        'slide-right':'slideRight 0.35s cubic-bezier(0.16,1,0.3,1)',
      },
      keyframes: {
        fadeIn:      { from: { opacity: '0' },              to: { opacity: '1' } },
        slideUp:     { from: { opacity: '0', transform: 'translateY(16px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideRight:  { from: { opacity: '0', transform: 'translateX(-100%)' }, to: { opacity: '1', transform: 'translateX(0)' } },
      },
    },
  },
  plugins: [],
}
export default config
