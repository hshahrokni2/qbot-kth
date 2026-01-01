// Fix hallucinated URLs in the database
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function main() {
  console.log('🔍 Checking for hallucinated URLs...\n')

  // Known hallucinated URL patterns - be more inclusive
  const suspiciousPatterns = [
    'digitalfutures.kth.se',
    'smart-urban-metabolism',
    'strategic-research-projects',
  ]

  // First, let's see what URLs exist
  const { data: allDocs, error: fetchError } = await supabase
    .from('documents')
    .select('id, title, source_url, author, year')
    .not('source_url', 'is', null)
    .limit(500)

  if (fetchError) {
    console.error('Error fetching:', fetchError)
    return
  }

  console.log(`Found ${allDocs.length} documents with URLs\n`)

  // Find suspicious entries
  const suspicious = allDocs.filter(doc => {
    if (!doc.source_url) return false
    return suspiciousPatterns.some(pattern => doc.source_url.includes(pattern))
  })

  console.log(`Found ${suspicious.length} potentially hallucinated entries:\n`)
  
  for (const doc of suspicious) {
    console.log(`ID: ${doc.id}`)
    console.log(`Title: ${doc.title}`)
    console.log(`URL: ${doc.source_url}`)
    console.log(`Author: ${doc.author}`)
    console.log(`Year: ${doc.year}`)
    console.log('---')
  }

  if (suspicious.length === 0) {
    console.log('No suspicious URLs found!')
    return
  }

  // Option 1: Clear the URLs (keep the content)
  console.log('\n🔧 Clearing hallucinated URLs (keeping content)...\n')
  
  for (const doc of suspicious) {
    const { error: updateError } = await supabase
      .from('documents')
      .update({ source_url: null })
      .eq('id', doc.id)
    
    if (updateError) {
      console.error(`Failed to update ${doc.id}:`, updateError)
    } else {
      console.log(`✅ Cleared URL for: ${doc.title.substring(0, 50)}...`)
    }
  }

  console.log('\n✅ Done! Hallucinated URLs have been cleared.')
}

main().catch(console.error)

