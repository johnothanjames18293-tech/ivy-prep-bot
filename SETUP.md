# Discord Bot Setup Instructions

## Prerequisites
- Node.js 18+ installed
- Discord Bot created in Discord Developer Portal
- Bot token and Application ID

## Installation Steps

1. **Navigate to discord-bot-standalone folder:**
\`\`\`bash
cd "/Volumes/My Passport for Mac/discord-bot-standalone"
\`\`\`

2. **Install dependencies:**
\`\`\`bash
npm install --legacy-peer-deps
\`\`\`

3. **Configure environment variables:**
Edit the `.env` file with your credentials (already done)

4. **Build the bot:**
\`\`\`bash
npm run build
\`\`\`

5. **Start the bot:**
\`\`\`bash
npm start
\`\`\`

## Usage

In Discord, use the `/pdf` command:
1. Select watermark style (Ekon&Flux, Himan, or Both)
2. Upload JSON file(s)
3. Bot will generate and send PDF links via Catbox

## Troubleshooting

If you get dependency errors, use:
\`\`\`bash
npm install --legacy-peer-deps --force
\`\`\`

If the bot doesn't start, check:
- `.env` file has correct DISCORD_TOKEN and DISCORD_CLIENT_ID
- Bot has proper permissions in Discord server
- Node.js version is 18 or higher
