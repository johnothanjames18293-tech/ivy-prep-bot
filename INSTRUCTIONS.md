# Discord Bot Setup Instructions

Your Discord bot is now ready! Here's what I've set up:

## What's Been Done

do 2. **Discord bot** calls this API to generate PDFs after solving questions
3. **All files are configured** with your Discord credentials

## How to Run

### Quick Start (Recommended)

The web app is deployed on Vercel, so you only need to start the Discord bot:

\`\`\`bash
cd "/Volumes/My Passport for Mac/discord-bot-standalone"
./start.sh
\`\`\`

Or manually:

\`\`\`bash
cd "/Volumes/My Passport for Mac/discord-bot-standalone"
npm install  # Only needed first time
npm run build
npm start
\`\`\`

### Alternative: Run Web App Locally (Optional)

If you want to run the web app locally instead of using Vercel:

\`\`\`bash
# Terminal 1: Start Web App
cd "/Volumes/My Passport for Mac/discord-bot"
npm run dev

# Terminal 2: Start Discord Bot
cd "/Volumes/My Passport for Mac/discord-bot-standalone"
npm run build
npm start
\`\`\`

## How to Use in Discord

1. Type `/pdf` in any channel where the bot has access
2. Select watermark style (Ekon&Flux, Himan, or Both)
3. **Important:** After selecting, upload your JSON file(s) in the same message
4. The bot will:
   - Download and parse your JSON files
   - Solve Module 2 questions using AI solver
   - Call the web app to generate the PDF
   - Upload to Catbox and send you the download link

## Troubleshooting

- **"PDF generation failed"**: Make sure the web app is running at http://localhost:3000
- **"Command not found"**: Make sure you ran `npm install` and `npm run build` first
- **Bot not responding**: Check that your Discord token is correct in `.env`

## Files Created

- `app/api/generate-pdf/route.ts` - API endpoint for PDF generation
- Discord bot files in `/Volumes/My Passport for Mac/discord-bot-standalone`
- Updated `.env` with WEB_APP_URL configuration
