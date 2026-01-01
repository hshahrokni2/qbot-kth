import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

const inter = Inter({ subsets: ['latin'] })

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXTAUTH_URL || 'http://localhost:3000'),
  title: 'QBOT - KTH Climate Research Assistant',
  description: 'Explore cutting-edge climate and sustainability research from KTH Royal Institute of Technology. Discover hope-inspiring solutions for our planet\'s future.',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
  },
  openGraph: {
    title: 'QBOT - KTH Climate Research Assistant',
    description: 'Explore cutting-edge climate and sustainability research from KTH Royal Institute of Technology',
    images: ['/og-image.png'],
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script src="https://apps.abacus.ai/chatllm/appllm-lib.js"></script>
        {process.env.NODE_ENV === 'production' ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `(function(){try{var noop=function(){};console.log=noop;console.info=noop;console.debug=noop;console.warn=noop;}catch(e){}})();`,
            }}
          />
        ) : null}
      </head>
      <body className={inter.className} suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          storageKey="qbot-theme"
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
