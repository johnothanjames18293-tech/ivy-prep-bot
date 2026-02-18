import 'dotenv/config'
import { REST, Routes } from 'discord.js'

const commands = [
  {
    name: 'pdf',
    description: 'Generate SAT PDF with watermarks from JSON files (up to 10 files)',
    options: [{
      name: 'file',
      description: 'SAT test JSON file',
      type: 11,
      required: true
    }]
  },
  {
    name: 'done',
    description: 'Merge all generated PDFs into one big PDF'
  },
  {
    name: 'reset',
    description: 'Clear the PDF session and start fresh'
  },
  {
    name: 'watermark',
    description: 'Add a diagonal watermark to a file',
    options: [
      {
        name: 'text',
        description: 'The watermark text',
        type: 3,
        required: true
      },
      {
        name: 'file',
        description: 'The file to watermark',
        type: 11,
        required: true
      }
    ]
  },
  {
    name: 'remove-watermark',
    description: 'Remove watermark from a file',
    options: [{
      name: 'file',
      description: 'The file to remove watermark from',
      type: 11,
      required: true
    }]
  }
]

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)

async function register() {
  try {
    console.log('Deleting all global commands...')
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: [] })
    
    console.log('Waiting 3 seconds...')
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    console.log('Registering 5 commands globally...')
    const result = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: commands }
    )
    
    console.log('✅ Commands registered:')
    result.forEach(cmd => console.log(`   /${cmd.name}`))
    console.log('\nNote: Global commands take 30-60 minutes to appear in Discord.')
  } catch (error) {
    console.error('Error:', error)
  }
}

register()
