export type Signal = '✅' | '⚠️' | '❌'

export function getSignalLabel(signal: Signal | null): string {
  switch (signal) {
    case '✅':
      return 'Positive'
    case '⚠️':
      return 'Neutral / Watch'
    case '❌':
      return 'Red Flag'
    default:
      return 'No Signal'
  }
}

export function getSignalBg(signal: Signal | null): string {
  switch (signal) {
    case '✅':
      return 'bg-green-50 border-green-200'
    case '⚠️':
      return 'bg-yellow-50 border-yellow-200'
    case '❌':
      return 'bg-red-50 border-red-200'
    default:
      return 'bg-gray-50 border-gray-200'
  }
}

export function getSignalBadge(signal: Signal | null): string {
  switch (signal) {
    case '✅':
      return 'bg-green-100 text-green-800'
    case '⚠️':
      return 'bg-yellow-100 text-yellow-800'
    case '❌':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}
