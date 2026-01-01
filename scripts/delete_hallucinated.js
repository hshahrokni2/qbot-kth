// Delete hallucinated entries from the database
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function main() {
  // These are the hallucinated URLs
  const hallucinatedUrls = [
    'https://www.digitalfutures.kth.se/research/smart-urban-metabolism',
    'https://www.digitalfutures.kth.se/research/strategic-research-projects/',
  ]

  console.log('🗑️  Deleting hallucinated entries...\n')

  for (const url of hallucinatedUrls) {
    // Find entries with this URL
    const { data: entries, error: findError } = await supabase
      .from('documents')
      .select('id, title, author')
      .eq('source_url', url)

    if (findError) {
      console.error(`Error finding ${url}:`, findError)
      continue
    }

    console.log(`Found ${entries?.length || 0} entries with URL: ${url}`)
    
    for (const entry of (entries || [])) {
      console.log(`  - "${entry.title}" by ${entry.author}`)
      
      // Delete the entry
      const { error: deleteError } = await supabase
        .from('documents')
        .delete()
        .eq('id', entry.id)

      if (deleteError) {
        console.error(`    ❌ Failed to delete:`, deleteError)
      } else {
        console.log(`    ✅ Deleted!`)
      }
    }
    console.log('')
  }

  console.log('✅ Done!')
}

main().catch(console.error)


