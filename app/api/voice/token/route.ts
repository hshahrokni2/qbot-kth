import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const KOMILION_API_KEY = process.env.KOMILION_API_KEY || ''

export async function GET() {
  if (!KOMILION_API_KEY) {
    return NextResponse.json({ error: 'KOMILION_API_KEY not configured' }, { status: 500 })
  }

  const res = await fetch('https://komilion.com/api/voice/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KOMILION_API_KEY,
    },
    body: JSON.stringify({ expiresIn: 3600 }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return NextResponse.json(
      { error: 'Failed to fetch Komilion client token', details: text || res.statusText },
      { status: 502 }
    )
  }

  const data = await res.json().catch(() => ({}))
  return NextResponse.json({ clientToken: data.clientToken })
}

