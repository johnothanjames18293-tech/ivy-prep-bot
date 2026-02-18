#!/bin/bash

# Start Discord Bot
echo "🚀 Starting Discord Bot..."
cd "/Volumes/My Passport for Mac/discord-bot-standalone"

# Check if node_modules exists, if not install
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build if dist doesn't exist or if source files are newer
if [ ! -d "dist" ] || [ "bot.ts" -nt "dist/bot.js" ]; then
    echo "🔨 Building bot..."
    npm run build
fi

echo "✅ Starting Discord Bot..."
npm start


