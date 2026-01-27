import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_KEY || ''
)

/**
 * Store user feedback for QBOT responses
 * POST /api/feedback
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      messageId, 
      type,        // 'up' | 'down'
      reason,      // Optional: 'missing_article' | 'wrong_info' | 'bad_audio' | 'other'
      comment,     // Optional: free text
      messageContent,
      sessionId
    } = body

    if (!messageId || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Try to insert into Supabase feedback table
    // If table doesn't exist, just log and return success
    try {
      const { error } = await supabase
        .from('feedback')
        .insert({
          message_id: messageId,
          feedback_type: type,
          reason: reason || null,
          comment: comment || null,
          message_content: messageContent?.slice(0, 1000) || null,
          session_id: sessionId || null,
          created_at: new Date().toISOString()
        })

      if (error) {
        // Table might not exist - log but don't fail
        console.log('Feedback storage note:', error.message)
      }
    } catch {
      // Supabase not configured or table doesn't exist
      console.log('Feedback received (not stored in DB):', { messageId, type, reason })
    }

    // Always log feedback for review
    console.log('📝 User Feedback:', {
      messageId,
      type,
      reason,
      comment,
      timestamp: new Date().toISOString()
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Feedback API error:', error)
    return NextResponse.json({ error: 'Failed to process feedback' }, { status: 500 })
  }
}

/**
 * GET - List recent feedback (for review)
 */
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) {
      return NextResponse.json({ error: 'Feedback table not configured' }, { status: 404 })
    }

    return NextResponse.json({ feedback: data })
  } catch {
    return NextResponse.json({ error: 'Feedback retrieval not available' }, { status: 404 })
  }
}
