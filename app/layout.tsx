import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Kelu',
  description: 'AI-powered financial news monitoring for Indian equity holdings',
  icons: {
    apple: '/apple-touch-icon.png',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 min-h-screen">{children}</body>
    </html>
  )
}
