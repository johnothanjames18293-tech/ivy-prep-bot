import "dotenv/config"
import { REST, Routes } from "discord.js"
import { pdfCommand } from "./commands/pdf.js"
import { doneCommand } from "./commands/done.js"
import { resetCommand } from "./commands/reset.js"
import { watermarkCommand } from "./commands/watermark.js"
import { watermarkremoverCommand } from "./commands/watermarkremover.js"

const commands = [
  pdfCommand.data.toJSON(),
  doneCommand.data.toJSON(),
  resetCommand.data.toJSON(),
  watermarkCommand.data.toJSON(),
  watermarkremoverCommand.data.toJSON(),
]

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!)

async function refreshCommands() {
  try {
    console.log("Deleting all existing commands...")
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), { body: [] })
    
    console.log("Waiting 2 seconds...")
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    console.log("Registering commands:", commands.map(c => c.name))
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), {
      body: commands,
    })
    
    console.log("✅ Commands refreshed successfully!")
    console.log("Available commands:", commands.map(c => `/${c.name}`).join(", "))
  } catch (error) {
    console.error("Error refreshing commands:", error)
  }
}

refreshCommands()
