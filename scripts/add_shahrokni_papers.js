// Add Shahrokni's related papers from his PhD thesis
const { createClient } = require('@supabase/supabase-js')
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
)

// Papers from https://kth.diva-portal.org/smash/record.jsf?pid=diva2%3A868753
const papers = [
  {
    title: "Smart Urban Metabolism: Towards a Real-Time Understanding of the Energy and Material Flows of a City and Its Citizens",
    author: "Shahrokni, Hossein; Lazarevic, David; Brandt, Nils",
    year: 2015,
    department: "KTH School of Architecture and the Built Environment, Industrial Ecology",
    source_url: "http://urn.kb.se/resolve?urn=urn:nbn:se:kth:diva-164525",
    doi: "10.1080/10630732.2014.954899",
    category: "carbon_neutrality",
    content: `Urban metabolism is a concept employed to understand the flow of energy and materials through urban areas. However, applying this approach at the city level has been limited by the lack of data at this scale. This paper reviews the current application of the urban metabolism concept and proposes the concept of a "smart urban metabolism" (SUM). Through integrating ICT and smart-city technologies, the SUM model can provide real-time feedback on energy and material flows, from the level of the household to the urban district. This is highlighted through an example of its application in the Stockholm Royal Seaport, Sweden. Keywords: ICT, material flow analysis, real-time, smart cities, urban metabolism. Published in The Journal of Urban Technology, Vol. 22, no 1, p. 65-86.`
  },
  {
    title: "Big meter data analysis of the energy efficiency potential in Stockholm's building stock",
    author: "Shahrokni, Hossein; Levihn, Fabian; Brandt, Nils",
    year: 2014,
    department: "KTH School of Architecture and the Built Environment, Industrial Ecology",
    source_url: "http://urn.kb.se/resolve?urn=urn:nbn:se:kth:diva-149188",
    doi: "10.1016/j.enbuild.2014.04.017",
    category: "carbon_neutrality",
    content: `The City of Stockholm is making substantial efforts towards meeting its climate change commitments including a GHG emission target of 3 tonnes per capita by 2020 and making its new eco-district Stockholm Royal Seaport a candidate of Clinton Climate Initiative's Climate Positive Program. This study evaluated the energy efficiency potential in the city using big meter data from Fortum. Analysis revealed that retrofitting the building stock to current building codes would reduce heating energy use by one third. The greatest reduction potential was found for buildings constructed between 1946 and 1975 due to the large number of buildings and their poor energy performance. The least energy-efficient buildings were those built between 1926 and 1945. Published in Energy and Buildings, Vol. 78, p. 153-164.`
  },
  {
    title: "Big Data GIS Analytics Towards Efficient Waste Management in Stockholm",
    author: "Shahrokni, Hossein; van der Heijde, Bram; Lazarevic, David; Brandt, Nils",
    year: 2014,
    department: "KTH School of Architecture and the Built Environment, Industrial Ecology",
    source_url: "http://urn.kb.se/resolve?urn=urn:nbn:se:kth:diva-149939",
    doi: "10.2991/ict4s-14.2014.17",
    category: "carbon_neutrality",
    content: `This paper presents findings from big data analysis and GIS to identify the efficiency of waste management and transportation in the City of Stockholm. Based on a large data set consisting of roughly half a million entries of waste fractions, weights, and locations, new waste generation maps were developed. Maps of selected vehicle routes were constructed and the efficiencies assessed using the efficiency index (kg waste/km). Substantial inefficiencies were revealed, and intervention measures are discussed to increase efficiency, including a shared waste collection vehicle fleet. Presented at 2nd International Conference on ICT for Sustainability (ICT4S), Stockholm.`
  },
  {
    title: "Making sense of smart city sensors",
    author: "Shahrokni, Hossein; Brandt, Nils",
    year: 2013,
    department: "KTH School of Industrial Engineering and Management, Industrial Ecology",
    source_url: "http://urn.kb.se/resolve?urn=urn:nbn:se:kth:diva-172653",
    doi: "10.1111/jiec.12308",
    category: "carbon_neutrality",
    content: `The rapid emergence of smart cities and their sensor networks is being accompanied by an increasing demand for systems to interpret and use the vast amounts of new data they make available. This paper describes the key system design decisions for smart city sensor interpretation systems, focusing on augmented reality, big data, industrial ecology, smart cities, sustainable city development, and urban metabolism. Published in Urban and Regional Data Management proceedings and Journal of Industrial Ecology.`
  }
]

async function main() {
  console.log('📚 Adding Shahrokni papers from DiVA thesis page...\n')

  for (const paper of papers) {
    // Check if already exists
    const { data: existing } = await supabase
      .from('documents')
      .select('id, title')
      .eq('source_url', paper.source_url)
      .single()

    if (existing) {
      console.log(`⏭️  Already exists: ${paper.title.substring(0, 50)}...`)
      continue
    }

    // Insert new paper
    const { error } = await supabase
      .from('documents')
      .insert([paper])

    if (error) {
      console.error(`❌ Failed to add: ${paper.title.substring(0, 50)}...`)
      console.error(error)
    } else {
      console.log(`✅ Added: ${paper.title.substring(0, 50)}...`)
    }
  }

  console.log('\n✅ Done!')
}

main().catch(console.error)

