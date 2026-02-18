# SAT PDF Generator Discord Bot

A Discord bot that generates SAT practice test PDFs with customizable watermarks from JSON files.

## Features

- `/pdf` slash command with watermark style selection
- Supports multiple JSON file uploads
- Generates PDFs with Ekon&Flux or Himan&Dzhour watermarks
- Uploads PDFs to Catbox.moe and returns download links
- Handles errors gracefully with user-friendly messages

## Setup

1. **Install Node.js:**
   - Download from [nodejs.org](https://nodejs.org/)
   - Install the LTS version
   - Verify: `node --version` and `npm --version`

2. **Install dependencies:**
   \`\`\`bash
   cd "/Volumes/My Passport for Mac/discord-bot-standalone"
   npm install
   \`\`\`

3. **Create a Discord Bot:**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Create a new application
   - Go to "Bot" section and create a bot
   - Copy the bot token
   - Enable "Message Content Intent" in Bot settings
   - Go to OAuth2 → URL Generator
   - Select scopes: `bot`, `applications.commands`
   - Select permissions: `Send Messages`, `Attach Files`, `Use Slash Commands`
   - Copy the generated URL and invite the bot to your server

4. **Configure environment variables:**
   - Open the `.env` file in the discord-bot-standalone folder
   - Add your Discord bot token and client ID:
     \`\`\`
     DISCORD_TOKEN=your_bot_token_here
     DISCORD_CLIENT_ID=your_application_id_here
     \`\`\`
   - The Supabase credentials will be pulled from your project environment

5. **Build and start the bot:**
   \`\`\`bash
   npm run build
   npm start
   \`\`\`

## Usage

1. In Discord, type `/pdf` and select a watermark style:
   - **Ekon&Flux** - Original watermark style
   - **Himan&Dzhour** - Alternative watermark style  
   - **Both** - Generates both versions

2. Attach one or more JSON files containing SAT test data

3. The bot will process the files and respond with Catbox.moe download links

## Troubleshooting

**"command not found: npm"**
- Install Node.js from nodejs.org
- Restart your terminal after installation

**"cd: no such file or directory"**
- Make sure you're in the correct folder
- Use `pwd` to see your current location
- Use `ls` to see available folders

**Bot doesn't respond to /pdf command**
- Check that the bot is online (green status in Discord)
- Make sure "Message Content Intent" is enabled in Discord Developer Portal
- Verify the bot has proper permissions in your server

## File Structure

- `bot.ts` - Main bot entry point
- `commands/pdf.ts` - PDF generation command handler
- `lib/` - Core logic (question parser)
- `utils/catbox.ts` - Catbox.moe upload utility
- `utils/pdf-generator.ts` - PDF generation wrapper

## Notes

- The bot uses AI for solving questions (solver to be configured)
- PDFs are uploaded to Catbox.moe to avoid Discord file size limits
- Generation may take 2-5 minutes depending on the number of questions
