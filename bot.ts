import { Client, GatewayIntentBits, REST, Routes, type Interaction } from "discord.js"
import dotenv from "dotenv"
import { pdfCommand, expireCommand } from "./commands/pdf.js"
import { doneCommand } from "./commands/done.js"
import { resetCommand } from "./commands/reset.js"
import { watermarkCommand } from "./commands/watermark.js"
import { watermarkremoverCommand } from "./commands/watermarkremover.js"
import { logsCommand } from "./commands/logs.js"
import { uploadCommand } from "./commands/upload.js"
import { unbindCommand } from "./commands/unbind.js"
import { presetCommand, loadPresets } from "./commands/preset.js"
import {
  ticketSetupCommand,
  ticketDeleteCommand,
  handleTicketButton,
  handleTicketSelect,
  handleTicketModal,
  handleTicketClose,
  handleTicketCloseConfirm,
} from "./commands/tickets.js"
import { 
  paymentInfoCommand, 
  paidCommand, 
  listCommand, 
  clearListCommand, 
  allExamsCommand, 
  distributeCommand,
  setLogsCommand,
  giveVouchCommand 
} from "./commands/server-manager.js"

dotenv.config()

const bot = (process.env.BOT || "elyxbook").toLowerCase()
const tokenKey = bot === "clover" ? "CLOVER_TOKEN" : "ELYXBOOK_TOKEN"
const clientIdKey = bot === "clover" ? "CLOVER_CLIENT_ID" : "ELYXBOOK_CLIENT_ID"
const DISCORD_TOKEN = process.env[tokenKey]
const DISCORD_CLIENT_ID = process.env[clientIdKey]

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error(`❌ Missing credentials for bot "${bot}". Check your .env file.`)
  process.exit(1)
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
})

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user?.tag} (bot: ${bot})`)

  const commands = [
    // PDF Generator commands
    pdfCommand.data.toJSON(),
    expireCommand.data.toJSON(),
    doneCommand.data.toJSON(),
    resetCommand.data.toJSON(),
    watermarkCommand.data.toJSON(),
    watermarkremoverCommand.data.toJSON(),
    logsCommand.data.toJSON(),
    uploadCommand.data.toJSON(),
    unbindCommand.data.toJSON(),
    // Server Manager commands
    paidCommand.data.toJSON(),
    listCommand.data.toJSON(),
    clearListCommand.data.toJSON(),
    allExamsCommand.data.toJSON(),
    distributeCommand.data.toJSON(),
    setLogsCommand.data.toJSON(),
    giveVouchCommand.data.toJSON(),
  ]

  // Clover-only commands
  if (bot === "clover") {
    commands.push(
      paymentInfoCommand.data.toJSON(),
      presetCommand.data.toJSON(),
      ticketSetupCommand.data.toJSON(),
      ticketDeleteCommand.data.toJSON(),
    )
  }

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN)

  try {
    console.log("🔄 Registering slash commands...")

    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands,
    })

    console.log(`✅ Successfully registered ${commands.length} slash commands!`)
    console.log("📋 Commands registered:")
    console.log("   " + commands.map((c: any) => `/${c.name}`).join(", "))
  } catch (error) {
    console.error("❌ Error registering commands:", error)
  }
})

client.on("interactionCreate", async (interaction: Interaction) => {
  // Handle autocomplete for preset selection
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true)
    if (focused.name === "preset") {
      const presets = loadPresets()
      const query = focused.value.toLowerCase()
      const choices = Object.keys(presets)
        .filter((name) => name.includes(query))
        .slice(0, 25)
        .map((name) => ({ name, value: name }))
      await interaction.respond(choices).catch(() => {})
    }
    return
  }

  // Handle ticket buttons
  if (interaction.isButton()) {
    try {
      if (interaction.customId === "ticket_create") {
        await handleTicketButton(interaction)
      } else if (interaction.customId === "ticket_close") {
        await handleTicketClose(interaction)
      } else if (interaction.customId === "ticket_close_confirm" || interaction.customId === "ticket_close_cancel") {
        await handleTicketCloseConfirm(interaction)
      }
    } catch (error) {
      console.error("[Bot] Button interaction error:", error)
    }
    return
  }

  // Handle ticket select menus
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId === "ticket_category") {
        await handleTicketSelect(interaction)
      }
    } catch (error) {
      console.error("[Bot] Select menu error:", error)
    }
    return
  }

  // Handle ticket modals
  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith("ticket_modal_")) {
        await handleTicketModal(interaction)
      }
    } catch (error) {
      console.error("[Bot] Modal error:", error)
    }
    return
  }

  if (!interaction.isChatInputCommand()) return

  // Owner role restriction for Clover bot (exempt: paymentinfo is public)
  if (bot === "clover" && interaction.guild) {
    const publicCommands = ["paymentinfo"]
    if (!publicCommands.includes(interaction.commandName)) {
      const member = interaction.guild.members.cache.get(interaction.user.id)
        || await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
      const hasOwner = member?.roles.cache.some(
        (role) => role.name.toLowerCase() === "owners"
      )
      if (!hasOwner) {
        await interaction.reply({ content: "❌ Only users with the **Owners** role can use this bot.", ephemeral: true })
        return
      }
    }
  }

  console.log(`[Bot] Received command: ${interaction.commandName}`)
  
  try {
    // PDF Generator commands
    if (interaction.commandName === "pdf") {
      await pdfCommand.execute(interaction)
    } else if (interaction.commandName === "expire") {
      await expireCommand.execute(interaction)
    } else if (interaction.commandName === "done") {
      await doneCommand.execute(interaction)
    } else if (interaction.commandName === "reset") {
      await resetCommand.execute(interaction)
    } else if (interaction.commandName === "watermark") {
      await watermarkCommand.execute(interaction)
    } else if (interaction.commandName === "watermarkremover") {
      await watermarkremoverCommand.execute(interaction)
    } else if (interaction.commandName === "logs") {
      await logsCommand.execute(interaction)
    } else if (interaction.commandName === "upload") {
      await uploadCommand.execute(interaction)
    } else if (interaction.commandName === "unbind") {
      await unbindCommand.execute(interaction)
    } else if (interaction.commandName === "preset") {
      await presetCommand.execute(interaction)
    } else if (interaction.commandName === "ticketsetup") {
      await ticketSetupCommand.execute(interaction)
    } else if (interaction.commandName === "deleteticket") {
      await ticketDeleteCommand.execute(interaction)
    }
    // Server Manager commands
    else if (interaction.commandName === "paymentinfo") {
      await paymentInfoCommand.execute(interaction)
    } else if (interaction.commandName === "paid") {
      await paidCommand.execute(interaction)
    } else if (interaction.commandName === "list") {
      await listCommand.execute(interaction)
    } else if (interaction.commandName === "clearlist") {
      await clearListCommand.execute(interaction)
    } else if (interaction.commandName === "allexams") {
      await allExamsCommand.execute(interaction)
    } else if (interaction.commandName === "distribute") {
      await distributeCommand.execute(interaction)
    } else if (interaction.commandName === "setlogs") {
      await setLogsCommand.execute(interaction)
    } else if (interaction.commandName === "givevouch") {
      await giveVouchCommand.execute(interaction)
    }
  } catch (error: any) {
    // Handle "Unknown interaction" errors gracefully (interaction expired)
    if (error.code === 10062 || error.message?.includes("Unknown interaction")) {
      console.log(`[Discord Bot] Interaction expired for command: ${interaction.commandName}`)
      return
    }
    
    // Log other errors but don't crash
    console.error(`[Discord Bot] Error handling command ${interaction.commandName}:`, error)
    
    // Try to send error message if interaction is still valid
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          content: `❌ An error occurred while processing your command. Please try again.`,
        })
      } else {
        await interaction.reply({
          content: `❌ An error occurred while processing your command. Please try again.`,
          ephemeral: true,
        })
      }
    } catch (replyError: any) {
      // If we can't reply, just log it
      if (replyError.code !== 10062) {
        console.error("[Discord Bot] Failed to send error message:", replyError)
      }
    }
  }
})

client.login(DISCORD_TOKEN)
