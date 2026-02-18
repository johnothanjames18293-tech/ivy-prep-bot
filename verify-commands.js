require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log('Fetching registered global commands...');
    const commands = await rest.get(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID)
    );
    
    console.log('\nCurrently registered global commands:');
    commands.forEach(cmd => {
      console.log(`  /${cmd.name} - ${cmd.description}`);
    });
    
    console.log(`\nTotal: ${commands.length} commands`);
    console.log('\nNote: Global commands can take up to 1 hour to appear in Discord.');
    console.log('For instant updates during development, use guild commands instead.');
  } catch (error) {
    console.error('Error:', error);
  }
})();
