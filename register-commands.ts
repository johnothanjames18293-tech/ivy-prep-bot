import { REST, Routes } from "discord.js"
import { config } from "dotenv"
import { pdfCommand } from "./commands/pdf.js"

config()

const commands = [pdfCommand.data.toJSON()]

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!)

;(async () => {
  try {
    console.log("Started refreshing application (/) commands.")

    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID!), {
      body: commands,
    })

    console.log("Successfully reloaded application (/) commands.")
  } catch (error) {
    console.error(error)
  }
})()
