import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        positive: '#34C759',
        negative: '#FF3B30',
        accent:   '#0A84FF',
        warning:  '#FF9500',
        signal: {
          buy:  '#34C759',
          hold: '#FF9500',
          trim: '#FF3B30',
          deep: '#30D158',
        },
      },
      fontSize: {
        'display':     ['32px', { lineHeight: '1.1', fontWeight: '700' }],
        'title-1':     ['22px', { lineHeight: '1.2', fontWeight: '700' }],
        'title-2':     ['20px', { lineHeight: '1.2', fontWeight: '600' }],
        'headline':    ['17px', { lineHeight: '1.3', fontWeight: '600' }],
        'body':        ['15px', { lineHeight: '1.4', fontWeight: '400' }],
        'subheadline': ['13px', { lineHeight: '1.4', fontWeight: '400' }],
        'footnote':    ['11px', { lineHeight: '1.4', fontWeight: '400' }],
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      minHeight: {
        tap: '44px',
      },
      minWidth: {
        tap: '44px',
      },
    },
  },
  plugins: [],
}

export default config
