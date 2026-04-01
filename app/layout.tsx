import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Public Outreach — Territory Management',
  description: 'PAP Territory Management Application for Public Outreach field teams.',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
