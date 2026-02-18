import 'dotenv/config'
import { REST, Routes } from 'discord.js'

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN)

async function verify() {
  try {
    console.log('Fetching registered global commands...\n')
    const commands = await rest.get(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
    )
    
    console.log('Currently registered global commands:')
    commands.forEach(cmd => {
      console.log(`  /${cmd.name} - ${cmd.description}`)
    })
    
    console.log(`\nTotal: ${commands.length} commands`)
    console.log('\nNote: Global commands can take up to 1 HOUR to appear in Discord.')
    console.log('If you see all 5 commands above, they are registered correctly.')
    console.log('Just wait for Discord to sync them globally (can take 30-60 minutes).')
  } catch (error) {
    console.error('Error:', error)
  }
}

verify()
