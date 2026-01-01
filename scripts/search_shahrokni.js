// Search for Shahrokni / Smart Urban Metabolism entries
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

async function main() {
  // Search for Shahrokni
  console.log('🔍 Searching for "Shahrokni"...\n')
  
  const { data: shahrokni, error: e1 } = await supabase
    .from('documents')
    .select('id, title, source_url, author, department, year, content')
    .or('author.ilike.%shahrokni%,title.ilike.%shahrokni%,content.ilike.%shahrokni%')
    .limit(20)

  if (e1) console.error(e1)
  
  console.log(`Found ${shahrokni?.length || 0} Shahrokni results:\n`)
  for (const doc of (shahrokni || [])) {
    console.log(`Title: ${doc.title}`)
    console.log(`Author: ${doc.author}`)
    console.log(`URL: ${doc.source_url}`)
    console.log(`Year: ${doc.year}`)
    console.log(`Dept: ${doc.department}`)
    console.log('---')
  }

  // Search for Smart Urban Metabolism
  console.log('\n🔍 Searching for "smart urban metabolism"...\n')
  
  const { data: sum, error: e2 } = await supabase
    .from('documents')
    .select('id, title, source_url, author, department, year')
    .or('title.ilike.%smart urban metabolism%,content.ilike.%smart urban metabolism%')
    .limit(20)

  if (e2) console.error(e2)
  
  console.log(`Found ${sum?.length || 0} "smart urban metabolism" results:\n`)
  for (const doc of (sum || [])) {
    console.log(`Title: ${doc.title}`)
    console.log(`Author: ${doc.author}`)
    console.log(`URL: ${doc.source_url}`)
    console.log(`Year: ${doc.year}`)
    console.log('---')
  }

  // Search for Digital Futures
  console.log('\n🔍 Searching for "Digital Futures"...\n')
  
  const { data: df, error: e3 } = await supabase
    .from('documents')
    .select('id, title, source_url, author, department, year')
    .or('title.ilike.%digital futures%,content.ilike.%digital futures%,department.ilike.%digital futures%')
    .limit(20)

  if (e3) console.error(e3)
  
  console.log(`Found ${df?.length || 0} "Digital Futures" results:\n`)
  for (const doc of (df || [])) {
    console.log(`Title: ${doc.title}`)
    console.log(`Author: ${doc.author}`)
    console.log(`URL: ${doc.source_url}`)
    console.log(`Year: ${doc.year}`)
    console.log('---')
  }
}

main().catch(console.error)


