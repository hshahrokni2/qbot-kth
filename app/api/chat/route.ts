import { NextRequest } from 'next/server'
import { generateEmbedding, correctSpelling } from '@/lib/embeddings'
import { searchDocuments } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // Increase timeout to 60 seconds for LLM streaming

// Log startup to verify API route is loading
console.log('✅ Chat API route loaded successfully')
console.log('🔑 Environment check:', {
  hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY,
  hasAbacusKey: !!process.env.ABACUSAI_API_KEY,
  hasSupabaseUrl: !!process.env.SUPABASE_URL,
  hasSupabaseKey: !!process.env.SUPABASE_KEY,
})

// Detect if the query is KTH-specific
function isKTHSpecificQuery(message: string): boolean {
  const kthKeywords = [
    'kth',
    'royal institute of technology',
    'at kth',
    'kth research',
    'kth doing',
    'kth working',
    'stockholm university',
  ]
  const lowerMessage = message?.toLowerCase?.() ?? ''
  return kthKeywords?.some?.((keyword) => lowerMessage?.includes?.(keyword)) ?? false
}

// LLM-based small talk detection
async function isSmallTalk(message: string): Promise<boolean> {
  const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
  const apiUrl = useOpenRouter
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://apps.abacus.ai/v1/chat/completions'
  const apiKey = useOpenRouter
    ? process.env.OPENROUTER_API_KEY
    : process.env.ABACUSAI_API_KEY

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...(useOpenRouter ? {
          'HTTP-Referer': 'https://qbot.abacusai.app',
          'X-Title': 'QBOT - Small Talk Detection',
        } : {}),
      },
      body: JSON.stringify({
        model: useOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a query classifier. Determine if the user's message requires database search OR can be handled without it.

SKIP DATABASE (classify as SMALL_TALK):
- Pure greetings with NO question: hi, hello, hey
- Thank you with NO follow-up: thanks, thank you
- Pure goodbyes: bye, goodbye, see you later
- Meta questions about conversation: "I have a non-climate question", "Can I ask about something else?"

REQUIRES DATABASE (classify as SUBSTANTIVE):
- ANY follow-up request: "show me", "tell me more", "what about X"
- Acknowledgments WITH implied questions: "cool, but...", "sure" (in context of continuing conversation)
- Requests for details: "papers", "researchers", "publications", "who", "what"
- Short responses in middle of conversation: "another", "more", "sure" (these continue the topic)
- Information requests: "What is BECCS?", "Tell me about climate change"
- Vague follow-ups: "something techy", "show me the goodies", etc.

CRITICAL RULES:
- If conversation history exists and user says short things like "sure", "cool", "show me" → SUBSTANTIVE (they're continuing the topic)
- ONLY classify as SMALL_TALK if it's a pure greeting/goodbye with NO implied continuation
- When in doubt → SUBSTANTIVE (let the system handle it, don't block searches)

OUTPUT: Respond with ONLY "SMALL_TALK" or "SUBSTANTIVE"
`
          },
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.1,
        max_tokens: 10
      })
    })

    if (response.ok) {
      const data = await response.json()
      const result = data.choices?.[0]?.message?.content?.trim().toUpperCase()
      console.log(`🎯 Small talk detection: "${message}" → ${result}`)
      return result === 'SMALL_TALK'
    }
  } catch (error) {
    console.error('Small talk detection failed:', error)
    // Fallback: simple pattern matching if LLM fails
    // VERY conservative - only catch pure greetings/goodbyes
    const lowerMessage = message?.toLowerCase?.().trim() ?? ''
    const smallTalkPatterns = [
      /^(hi|hello|hey)$/,  // Pure greetings only
      /^(bye|goodbye)$/,    // Pure goodbyes only
      /^(thanks?|thank\s+you)$/,  // Pure thanks only
      // Meta-questions about conversation
      /non[- ]?climate/i,
      /^i (have|want).*(non|different)/i,
    ]
    
    // If it contains ANY of these words, it's substantive (even if short)
    const substantiveKeywords = ['show', 'tell', 'what', 'who', 'how', 'papers', 'researchers', 'pubs', 'more', 'another', 'explain']
    if (substantiveKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return false  // NOT small talk
    }
    
    return smallTalkPatterns.some(pattern => pattern.test(lowerMessage))
  }

  return false
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()

  try {
    const { message, history, thinkingMode, files } = await request?.json?.()

    if (!message?.trim?.() && (!files || files.length === 0)) {
      return new Response('Message or files required', { status: 400 })
    }
    
    console.log(`🧠 Thinking mode: ${thinkingMode ? 'ENABLED (using gpt-5.2)' : 'DISABLED (using gpt-5.2-chat)'}`)
    if (files && files.length > 0) {
      console.log(`📎 Files attached: ${files.length} file(s)`)
    }

    // Log environment status for debugging
    console.log('🔍 Environment check:', {
      hasOpenRouterKey: !!process?.env?.OPENROUTER_API_KEY,
      hasAbacusKey: !!process?.env?.ABACUSAI_API_KEY,
      hasSupabaseUrl: !!process?.env?.SUPABASE_URL,
      hasSupabaseKey: !!process?.env?.SUPABASE_KEY,
      nodeEnv: process.env.NODE_ENV
    })
    
    // Check if we have a valid API key
    if (!process?.env?.OPENROUTER_API_KEY && !process?.env?.ABACUSAI_API_KEY) {
      console.error('❌ CRITICAL: Missing LLM API keys in environment')
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('API') || k.includes('KEY')))
      
      return new Response(
        JSON.stringify({ 
          error: 'Service temporarily unavailable. Please try again in a moment.',
          details: 'API configuration issue'
        }), 
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    // PARALLEL PROCESSING: Run small talk detection AND spell correction simultaneously
    // This saves ~500ms by not waiting for small talk detection before starting other work
    const [smallTalk, correctedMessage] = await Promise.all([
      isSmallTalk(message),
      correctSpelling(message)
    ])
    
    console.log(`🎯 Small talk check: ${smallTalk ? 'YES (skip DB search)' : 'NO (search DB)'}`)
    if (correctedMessage !== message) {
      console.log(`🔧 Spell corrected: "${message}" → "${correctedMessage}"`)
    }
    
    // Use corrected message for search (but keep original for display)
    const searchMessage = correctedMessage

    // SMART QUERY REWRITING
    // Use LLM to detect vague queries AND rewrite them in a single call
    let searchQuery = searchMessage // Start with spell-corrected message
    let isListNamesQuery = false
    
    if (history && Array.isArray(history) && history.length > 0 && searchMessage.split(' ').length < 15) {
      console.log(`🧠 Checking if query needs rewriting: "${searchMessage}"`)
      
      // Extract last 3 conversation turns for context
      const recentContext = history.slice(-6).map((msg: any) => 
        `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 400)}`
      ).join('\n')
      
      console.log(`📝 History context (${history.slice(-6).length} messages):`)
      console.log(recentContext)
      
      try {
        // Use LLM to detect if vague and rewrite in one call
        const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
        const apiUrl = useOpenRouter
          ? 'https://openrouter.ai/api/v1/chat/completions'
          : 'https://apps.abacus.ai/v1/chat/completions'
        const apiKey = useOpenRouter
          ? process.env.OPENROUTER_API_KEY
          : process.env.ABACUSAI_API_KEY
        
        const rewriteResponse = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            ...(useOpenRouter ? {
              'HTTP-Referer': 'https://qbot.abacusai.app',
              'X-Title': 'QBOT - Query Rewriting',
            } : {}),
          },
          body: JSON.stringify({
            model: useOpenRouter ? 'openai/gpt-4o-mini' : 'gpt-4.1-mini',
            messages: [
              {
                role: 'system',
                content: `You are a smart query analysis and rewriting assistant.

TASK: Analyze if the user's query is vague or context-dependent. If YES, rewrite it. If NO, return "KEEP_ORIGINAL".

A query is VAGUE if it:
- Contains pronouns without clear referents (this, that, it, them, they, he, she)
- Refers to previous topics ("the research", "the project", "the study", "those papers")
- Asks about previously mentioned entities ("who are they?", "list them", "tell me more")
- Lacks context needed to search ("what about it?", "how does that work?")

A query is SPECIFIC if it:
- Contains clear nouns and topics ("What is BECCS?", "KTH wind energy research")
- Can be understood without conversation history
- Has no pronouns or vague references

REWRITING RULES (only if vague):
- Extract key entities, topics, acronyms from conversation history
- Replace pronouns with specific nouns
- CRITICAL: Preserve technical terms (BECCS, CCS, AI, etc.) and project names
- For "list them/who are they" about people → return ONLY the research TOPIC (e.g., "BECCS", NOT "BECCS researchers")
- Keep concise (max 10 words, preferably 1-3 words for name queries)
- Focus on searchable keywords

OUTPUT FORMAT:
- If vague: Return ONLY the rewritten query
- If specific: Return exactly "KEEP_ORIGINAL"

EXAMPLES:

History: User asked about BECCS at Stockholm Exergi. Bot explained it's a carbon capture project.
Query: "What is the research about?"
Output: BECCS carbon capture research Stockholm Exergi

History: Bot explained "Most of the BECCS work comes from groups at KTH".
Query: "list them"
Output: BECCS

History: Bot mentioned wind energy research at KTH.
Query: "who are they?"
Output: wind energy researchers KTH

History: Previous discussion about BECCS.
Query: "What is KTH doing with bioenergy?"
Output: KEEP_ORIGINAL

History: Discussion about climate change.
Query: "Tell me about renewable energy research at KTH"
Output: KEEP_ORIGINAL`
                },
                {
                  role: 'user',
                  content: `Conversation history:\n${recentContext}\n\nUser query: "${searchMessage}"\n\nYour response:`
                }
              ],
              temperature: 0.3,
              max_tokens: 60
            })
          })
          
          if (rewriteResponse.ok) {
            const rewriteData = await rewriteResponse.json()
            let rewrittenQuery = rewriteData.choices?.[0]?.message?.content?.trim()
            
            console.log(`🤖 LLM analysis response:`, JSON.stringify(rewriteData.choices?.[0]?.message, null, 2))
            
            // Strip extra quotes that LLM might add
            if (rewrittenQuery) {
              // Remove surrounding quotes: "\"text\"" → "text"
              rewrittenQuery = rewrittenQuery.replace(/^["']+|["']+$/g, '')
              // Remove escaped quotes: \"text\" → text
              rewrittenQuery = rewrittenQuery.replace(/\\["']/g, '')
              rewrittenQuery = rewrittenQuery.trim()
            }
            
            // Check if LLM said to keep original
            if (rewrittenQuery === 'KEEP_ORIGINAL') {
              console.log(`✅ Query is already specific, no rewriting needed`)
              console.log(`   Using original: "${message}"`)
              // searchQuery remains as message (already set above)
            } else if (rewrittenQuery && rewrittenQuery.length > 3) {
              // LLM determined query is vague and rewrote it
              searchQuery = rewrittenQuery
              console.log(`🔄 Query was vague, LLM rewrote it:`)
              console.log(`   Original: "${message}"`)
              console.log(`   Rewritten: "${searchQuery}"`)
              
              // SPECIAL HANDLING: If this is a "list names" query, extract just the topic
              // Example: "BECCS researchers at KTH" → search "BECCS" to get papers with authors
              const isListNamesPattern = /\b(researchers?|authors?|scientists?|professors?|names?|people|team|groups?)\b/i.test(rewrittenQuery)
              if (isListNamesPattern) {
                isListNamesQuery = true
                // Extract topic keywords (remove "names", "researchers", "KTH", "at", etc.)
                const topicWords = searchQuery
                  .replace(/\b(names?|of|the|researchers?|authors?|at|kth|professors?|scientists?|team|group|people|who|working|on|in)\b/gi, ' ')
                  .trim()
                  .split(/\s+/)
                  .filter((word: string) => word.length > 3)
                
                // Prioritize technical/specific terms (all caps, camelCase, or >6 chars)
                const technicalTerms = topicWords.filter((word: string) => 
                  /^[A-Z]{3,}$/.test(word) || // All caps (BECCS, CCS)
                  word.length > 6 || // Long specific terms
                  /[A-Z][a-z]+[A-Z]/.test(word) // CamelCase
                )
                
                const finalQuery = technicalTerms.length > 0 
                  ? technicalTerms.join(' ')
                  : topicWords.slice(0, 3).join(' ')
                
                if (finalQuery.length > 2) {
                  searchQuery = finalQuery
                  console.log(`📋 "List names" query detected - searching for topic: "${searchQuery}"`)
                  console.log(`   Extracted from: "${rewrittenQuery}"`)
                }
              }
            } else {
              console.log(`⚠️ LLM output too short or empty, using original query`)
            }
          } else {
            console.error(`❌ Rewriter API failed with status ${rewriteResponse.status}`)
          }
      } catch (rewriteError) {
        console.error('⚠️ Query rewriting failed, using original:', rewriteError)
        // Fallback: use original query
      }
    }

    // Determine if query is KTH-specific or global
    const isKTHQuery = isKTHSpecificQuery(searchQuery)

    // Always search KTH database for relevant information (UNLESS it's small talk)
    let relevantDocs: Array<any> = []
    let kthContext = ''
    let sources: Array<any> = []

    // Skip database search for small talk (greetings, thank you, etc.)
    if (!smallTalk) {
      try {
        // Try to generate embedding and search (using rewritten query)
        let queryEmbedding: number[] | null = null
        try {
          queryEmbedding = await generateEmbedding(searchQuery)
        } catch (embError) {
          console.error('Embedding generation failed, will proceed without vector search:', embError)
        }

        // For KTH queries, use moderate threshold to balance quality and recall
        // Hybrid scoring: 40% vector similarity + 60% keyword matching (prioritize keywords!)
        // Lowered to 0.45 to catch edge cases like "what is beccs and what is kth doing about it"
        const threshold = isKTHQuery ? 0.45 : 0.40
        const maxResults = isKTHQuery ? 5 : 3

        console.log(`🔍 Original query: "${message}"`)
        if (searchQuery !== message) {
          console.log(`🔍 Rewritten for search: "${searchQuery}"`)
        }
        console.log(`🔍 Type: ${isKTHQuery ? 'KTH' : 'Global'} | Threshold: ${threshold}`)

        if (queryEmbedding) {
          // Pass rewritten query for keyword-based hybrid search
          relevantDocs = await searchDocuments(queryEmbedding, maxResults, threshold, searchQuery)
          console.log(`📚 Found ${relevantDocs?.length ?? 0} documents (before validation)`)
        }

      if (relevantDocs && relevantDocs?.length > 0) {
        // SOURCE VALIDATION: Filter out low-quality or irrelevant sources
        // Only show sources with strong hybrid scores (60%+) to avoid nonsensical refs
        const qualitySources = relevantDocs.filter(doc => {
          const score = doc?.similarity ?? 0
          // For display: require 55% hybrid score (lowered from 60% for conversational queries)
          // Technical terms are now weighted 3x in keyword matching, so scores are more reliable
          return score >= 0.55
        })

        // If strict filtering removes all sources, fall back to top 3 with 45%+ score
        // This ensures casual questions like "what's the deal with X" still get sources
        const sourcesToShow = qualitySources.length > 0 
          ? qualitySources.slice(0, 5)  // Max 5 quality sources
          : relevantDocs.filter(doc => (doc?.similarity ?? 0) >= 0.45).slice(0, 3)  // Fallback: top 3

        kthContext = relevantDocs
          ?.map?.(
            (doc, idx) =>
              `[Source ${idx + 1}]\nTitle: ${doc?.title ?? 'Untitled'}\nAuthors: ${doc?.author ?? 'Unknown'}\nDepartment: ${doc?.department ?? 'KTH'}\nCategory: ${doc?.category ?? 'General'}\nContent: ${doc?.content?.slice?.(0, 800) ?? ''}...\n`
          )
          ?.join?.('\n---\n') ?? ''

        // Only include validated sources in citation display
        sources = sourcesToShow?.map?.((doc) => ({
          title: doc?.title ?? 'Untitled',
          url: doc?.url ?? undefined,  // Now standardized to 'url' (mapped from source_url)
          authors: doc?.author ?? undefined,
          department: doc?.department ?? undefined,
          category: doc?.category ?? undefined,
          year: doc?.year ?? undefined,  // Include publication year from RPC
        })) ?? []
        
        console.log(`✅ Validated ${sources.length} sources for display`)
      } else {
        console.log(`⚠️ No documents found or all filtered out`)
      }
      } catch (error) {
        console.error('Error searching KTH database:', error)
      }
    } else {
      console.log('💬 Small talk detected - skipping database search')
    }

    // Create context-aware system prompt
    let systemPrompt = ''

    if (smallTalk) {
      console.log(`📝 Using system prompt: Small talk/greeting`)
      // Small talk - friendly, no research needed
      systemPrompt = `You are QBOT, a friendly AI assistant for KTH climate research. The user is making small talk or a meta-statement about the conversation.

Respond warmly and briefly (1-2 sentences max):
- For greetings: "Hi! I'm QBOT, here to help you explore KTH's climate and sustainability research. What would you like to know?"
- For thank you: "You're welcome! Feel free to ask me anything about climate research at KTH."
- For goodbye: "Take care! Feel free to come back anytime with questions about climate research."
- For acknowledgments (ok, cool, etc.): "Is there anything else you'd like to explore about KTH's research?"
- For meta-questions ("I have a non-climate question", "Can I ask about something else?"): "Of course! I'm here to help. What's on your mind?"

Keep it natural, warm, and inviting. Single short response, no formatting needed.`
    } else if (isKTHQuery && kthContext) {
      console.log(`📝 Using system prompt: KTH with research context (${sources.length} sources)`)
      // KTH-focused response with found research
      systemPrompt = `You are QBOT, a friendly AI guide helping students discover KTH's climate research. Your audience is 16-23 year olds considering studying at KTH.

TONE & STYLE:
- Casual, relatable, encouraging (like talking to a friend who's excited about science)
- Use "you" and "we" - make it personal
- Celebrate the cool factor of the research
- Skip academic jargon - explain everything in plain English
- Think Gen Z communication: clear, concise, authentic

CONVERSATION AWARENESS (CRITICAL):
- You can see the full conversation history below
- If the user asks a follow-up question, BUILD ON what you already told them
- Reference previous information when relevant: "Remember the Stockholm Exergi project I mentioned?"
- Don't repeat yourself - add NEW insights or dive deeper
- If they ask for more details on something you mentioned, elaborate on it

SPECIAL: Listing Researcher Names
- If the user asks to "list them" or "who are they?" after discussing a research topic:
- Extract unique author names from the sources provided below
- Present as a bulleted list with clear formatting
- Group by department if multiple departments are present
- Example: "**BECCS Researchers at KTH:**\n- Fabian Levihn (Industrial Economics)\n- Oscar Stenström (Energy Technology)"

RESPONSE STRUCTURE (MANDATORY) - CLAUDE AIRY STYLE:

**Use questions as section headers** - turn key points into questions readers are thinking

**CRITICAL SPACING RULES - FOLLOW EXACTLY:**
1. **One blank line** before every heading (###) - ALWAYS
2. **One blank line** after EVERY paragraph (even if paragraph has 2-3 sentences) - ALWAYS
3. A "paragraph" = 1-3 sentences about the same point
4. NEVER write multiple paragraphs in a row without blank lines between them


**Example Structure (FOLLOW THIS EXACTLY):**

KTH research tackles climate challenges head-on. It's about real-world solutions, not just lab experiments.

Instead of just studying problems, KTH researchers partner with cities and companies to implement changes. This means faster impact and better results.

### What makes this different?

KTH doesn't work in isolation—they collaborate with 20+ Swedish cities through programs like Viable Cities.

These partnerships mean research gets tested in real life immediately. No waiting decades to see if it works.

### Why should you care as a student?

You'd be learning from projects that are already making a difference.

Skills learned here translate directly to jobs in climate action and urban planning.

Want to explore [specific aspect]?

**KEY FORMATTING RULES:**
- EMOJIS: Max 2-3 per response, only for emphasis
- EVERY paragraph gets a blank line after it (even multi-sentence paragraphs)
- If you write 2-3 sentences together, that's ONE paragraph - then ADD BLANK LINE
- Never write paragraphs back-to-back without spacing

---

Context from KTH Research:
${kthContext}

SYNTHESIS RULES:
✅ DO:
- Prioritize information from the sources provided above
- Start with what the research DOES (impact first, not methodology)
- Use real numbers from sources (but round/simplify them)
- Name specific researchers or departments when they appear in sources
- Connect to real-world problems students care about
- Explain technical terms immediately: "BECCS (it's basically carbon capture plus energy)"
- Reference previous conversation turns when answering follow-ups
- Supplement with general knowledge when sources are limited, but be clear about what's from sources vs general knowledge

❌ DON'T:
- Start with background/history (get to the point!)
- Use phrases like "According to research..." (just state the fact)
- List multiple studies - pick the most interesting one
- Write dense paragraphs - add line breaks!
- Ignore what you already told them in previous messages
- Invent specific paper titles or publication details not in sources

RESPONSE VARIETY (CRITICAL):
- Never start with "Climate tech is evolving fast" - this is overused
- Vary your openings using these patterns:
  * Start with a direct answer: "BECCS stands for..."
  * Start with impact: "KTH researchers are already removing 800,000 tons of CO₂..."
  * Start with a hook: "What if you could make energy AND fight climate change at the same time?"
  * Start with what's unique: "Unlike most universities, KTH actually partners with cities to test this..."
- Each response should feel fresh and different

Remember: Citations appear separately below. Your job is to make the research exciting and understandable, not to be a reference list.`
    } else if (isKTHQuery && !kthContext) {
      console.log(`📝 Using system prompt: KTH with NO research context (zero results)`)
      // KTH query but no relevant documents found
      systemPrompt = `You are QBOT, helping students explore KTH climate research. You don't have specific research papers for this query in your database.

IMPORTANT: Check the conversation history first!
- If you already discussed this topic in previous messages, reference that: "Earlier I mentioned..."
- If it's a follow-up question, build on what you already said
- Use general knowledge about the topic when helpful

RESPONSE OPTIONS:
1. **If it's a follow-up**: Build on what you already told them with more details or general knowledge
2. **If it's new**: Use general knowledge to answer, but note you don't have specific KTH papers
3. **Offer alternatives**: Suggest related KTH research areas you CAN search for

Keep it SHORT and helpful (under 100 words).

**EXAMPLE FORMAT (FOLLOW THIS):**

I don't have specific KTH papers on this exact topic in my database.

But here's what I know from general climate research: [brief 1-2 sentence answer]

Want me to search for related topics like [Topic A], [Topic B], or [Topic C]?

**CRITICAL FORMATTING:**
- One blank line after EVERY paragraph
- Even if paragraph has 2-3 sentences, add blank line after it
- NEVER write multiple paragraphs without blank lines between them

TONE: Friendly and helpful, not apologetic. Balance honesty with being useful.`
    } else {
      console.log(`📝 Using system prompt: Global query (${kthContext ? 'with' : 'without'} KTH context)`)
      // Global research query
      const kthAddition = kthContext
        ? `\n\n**Complementary KTH Research:**\n${kthContext}`
        : ''

      systemPrompt = `You are QBOT, helping students understand global climate solutions. Your audience is 16-23 year olds.

TONE: Hopeful, clear, relatable - like an enthusiastic science communicator

CONVERSATION AWARENESS:
- You can see the full conversation history
- If this is a follow-up question, reference what you already discussed
- Build on previous context instead of repeating yourself

RESPONSE STRUCTURE - CLAUDE AIRY STYLE (FOLLOW EXACTLY):

Climate tech is evolving fast. Here's what's working now.

Researchers are testing this in real-world conditions, not just labs. Early results show 40% improvement in efficiency.

### What makes this different?

This approach tackles the root cause, not just symptoms.

It's already being deployed in 15+ countries with proven results.

Want to know more? [Specific follow-up question]

**CRITICAL FORMATTING RULES:**
- **One blank line** before every heading - ALWAYS
- **One blank line** after EVERY paragraph (even if 2-3 sentences) - ALWAYS
- A paragraph = 1-3 sentences about same point, then BLANK LINE
- NEVER write multiple paragraphs without blank lines between them
- Emojis: Max 2-3 for the whole response
- Make it scannable - no walls of text

CONTENT:
- Start SIMPLE, add complexity gradually
- Explain jargon immediately
- Focus on solutions and progress (not doom)
- Use real numbers but round them ("reduced by 40%" not "39.7%")
- Reference previous conversation when relevant${kthContext ? '\n- Mention KTH connections when relevant' : ''}

${kthAddition ? 'Additional Context:\n' + kthAddition : ''}

RESPONSE VARIETY (CRITICAL):
- Never start with "Climate tech is evolving fast" - this is overused
- Vary your openings using these patterns:
  * Start with a direct answer to the question
  * Start with an interesting fact or number
  * Start with a question that hooks the reader
  * Start with what makes this topic unique
- Each response should feel fresh and different

Remember: Be encouraging and inspiring, not preachy or academic.`
    }

    // Build conversation history
    const conversationHistory: Array<{ role: string; content: string }> = []
    
    // Add system prompt
    conversationHistory.push({ role: 'system', content: systemPrompt })
    
    // Add conversation history if provided (only content from previous messages)
    if (history && Array.isArray(history) && history.length > 0) {
      // Take last 10 messages to keep context manageable
      const recentHistory = history.slice(-10)
      for (const msg of recentHistory) {
        if (msg?.role && msg?.content) {
          conversationHistory.push({
            role: msg.role,
            content: msg.content,
          })
        }
      }
    }
    
    // Add current user message with files if present
    if (files && files.length > 0) {
      // OpenAI vision API format
      const content: any[] = []
      
      // Add text if present
      if (message?.trim()) {
        content.push({ type: 'text', text: message })
      }
      
      // Add images
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          content.push({
            type: 'image_url',
            image_url: { url: file.data }
          })
        } else {
          // For non-image files, add as text description
          content.push({
            type: 'text',
            text: `[Attached file: ${file.name}]`
          })
        }
      }
      
      conversationHistory.push({ role: 'user', content: content as any })
    } else {
      conversationHistory.push({ role: 'user', content: message })
    }

    // Determine which API to use
    const useOpenRouter = !!process?.env?.OPENROUTER_API_KEY
    const apiUrl = useOpenRouter
      ? 'https://openrouter.ai/api/v1/chat/completions'
      : 'https://apps.abacus.ai/v1/chat/completions'
    const apiKey = useOpenRouter
      ? process.env.OPENROUTER_API_KEY
      : process.env.ABACUSAI_API_KEY
    
    // Model selection based on thinking mode
    let model: string
    if (thinkingMode && useOpenRouter) {
      model = 'openai/gpt-5.2' // Extended thinking model
      console.log('🧠 Using gpt-5.2 (thinking mode) for extended reasoning')
    } else if (useOpenRouter) {
      model = 'openai/gpt-5.2-chat' // Standard conversational model
      console.log('💬 Using gpt-5.2-chat (standard mode)')
    } else {
      model = 'gpt-4.1-mini' // Fallback to Abacus.AI
    }

    // Stream the response
    const stream = new ReadableStream({
      async start(controller) {
        try {
          console.log(`🔄 Fetching from ${useOpenRouter ? 'OpenRouter' : 'Abacus.AI'}: ${apiUrl}`)
          console.log(`📝 Using model: ${model}`)
          
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
              ...(useOpenRouter
                ? {
                    'HTTP-Referer': 'https://qbot.abacusai.app',
                    'X-Title': 'QBOT - KTH Climate Research Assistant',
                  }
                : {}),
            },
            body: JSON.stringify({
              model: model,
              messages: conversationHistory,
              stream: true,
              max_tokens: 3000,
              temperature: 0.7,
            }),
          })

          if (!response?.ok || !response?.body) {
            throw new Error(`LLM API error: ${response?.status}`)
          }

          const reader = response?.body?.getReader?.()
          if (!reader) throw new Error('No reader available')

          const decoder = new TextDecoder()
          let partialRead = ''

          while (true) {
            const { done, value } = await reader?.read?.()
            if (done) {
              // Send sources at the end if available
              if (sources?.length > 0) {
                const sourcesChunk = JSON.stringify({ sources })
                controller?.enqueue?.(encoder?.encode?.(`data: ${sourcesChunk}\n\n`) ?? new Uint8Array())
              }
              controller?.enqueue?.(encoder?.encode?.('data: [DONE]\n\n') ?? new Uint8Array())
              break
            }

            partialRead += decoder?.decode?.(value, { stream: true }) ?? ''
            const lines = partialRead?.split?.('\n') ?? []
            partialRead = lines?.pop?.() ?? ''

            for (const line of lines ?? []) {
              if (line?.startsWith?.('data: ')) {
                const data = line?.slice?.(6) ?? ''
                if (data === '[DONE]') {
                  continue
                }
                try {
                  const parsed = JSON.parse(data)
                  const content = parsed?.choices?.[0]?.delta?.content ?? ''
                  if (content) {
                    const chunk = JSON.stringify({ content })
                    controller?.enqueue?.(encoder?.encode?.(`data: ${chunk}\n\n`) ?? new Uint8Array())
                  }
                } catch (e) {
                  // Skip invalid JSON
                }
              }
            }
          }

          controller?.close?.()
        } catch (error) {
          console.error('❌ Stream error:', error)
          if (error instanceof Error) {
            console.error('Error message:', error.message)
            console.error('Error stack:', error.stack)
          }
          const errorChunk = JSON.stringify({
            content: "I'm having trouble connecting right now. Please try again in a moment!",
          })
          controller?.enqueue?.(encoder?.encode?.(`data: ${errorChunk}\n\n`) ?? new Uint8Array())
          controller?.enqueue?.(encoder?.encode?.('data: [DONE]\n\n') ?? new Uint8Array())
          controller?.close?.()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (error) {
    console.error('API Error:', error)
    return new Response('Internal server error', { status: 500 })
  }
}
