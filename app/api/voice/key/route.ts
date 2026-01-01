import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Securely provide API key to authenticated clients
 * In production, add proper authentication checks
 */
export async function GET() {
  const apiKey = process.env.KOMILION_API_KEY || ''
  
  return NextResponse.json({ 
    apiKey: apiKey ? apiKey : null,
    mode: apiKey ? 'premium' : 'demo'
  })
}

