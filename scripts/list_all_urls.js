// List all URLs in the database
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function main() {
  // Get all documents with non-null URLs
  const { data, error } = await supabase
    .from('documents')
    .select('id, title, source_url, author')
    .not('source_url', 'is', null)
    .order('source_url')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log(`Total documents with URLs: ${data.length}\n`)
  
  // Group by URL domain
  const byDomain = {}
  for (const doc of data) {
    try {
      const url = new URL(doc.source_url)
      const domain = url.hostname
      if (!byDomain[domain]) byDomain[domain] = []
      byDomain[domain].push(doc)
    } catch (e) {
      if (!byDomain['invalid']) byDomain['invalid'] = []
      byDomain['invalid'].push(doc)
    }
  }

  console.log('URLs by domain:\n')
  for (const [domain, docs] of Object.entries(byDomain).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${domain}: ${docs.length} documents`)
    // Show first few
    for (const doc of docs.slice(0, 3)) {
      console.log(`  - ${doc.source_url}`)
      console.log(`    Title: ${doc.title?.substring(0, 50)}...`)
    }
    if (docs.length > 3) console.log(`  ... and ${docs.length - 3} more`)
    console.log('')
  }
}

main().catch(console.error)


