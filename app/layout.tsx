import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AI Operations Copilot',
  description: 'Internal operations platform — Phase 2 verification',
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  )
}
