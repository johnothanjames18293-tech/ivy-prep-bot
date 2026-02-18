require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
  {
    name: 'pdf',
    description: 'Generate a PDF from SAT test JSON',
    options: [
      {
        name: 'file',
        description: 'The SAT test JSON file',
        type: 11, // ATTACHMENT
        required: true
      }
    ]
  },
  {
    name: 'done',
    description: 'Merge all generated PDFs into one'
  },
  {
    name: 'reset',
    description: 'Clear the PDF session'
  },
  {
    name: 'watermark',
    description: 'Add a diagonal watermark to a file',
    options: [
      {
        name: 'text',
        description: 'The watermark text',
        type: 3, // STRING
        required: true
      },
      {
        name: 'file',
        description: 'The file to watermark (PDF, image, etc)',
        type: 11, // ATTACHMENT
        required: true
      }
    ]
  },
  {
    name: 'remove-watermark',
    description: 'Remove watermark from a file',
    options: [
      {
        name: 'file',
        description: 'The file to remove watermark from',
        type: 11, // ATTACHMENT
        required: true
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

// REPLACE THIS WITH YOUR ACTUAL GUILD/SERVER ID
const GUILD_ID = 'YOUR_GUILD_ID_HERE';

(async () => {
  try {
    console.log('Deleting existing guild commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, GUILD_ID),
      { body: [] }
    );

    console.log('Registering guild commands...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log('✅ Guild commands registered successfully!');
    console.log('Commands:', commands.map(c => `/${c.name}`).join(', '));
    console.log('\nThey should appear INSTANTLY in your Discord server!');
  } catch (error) {
    console.error('Error:', error);
  }
})();
