import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder, PermissionFlagsBits, TextChannel, AttachmentBuilder } from "discord.js"
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import fs from "fs"
import path from "path"

// Supabase client for protected links
let supabaseInstance: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured')
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseKey)
  }
  return supabaseInstance
}

// Create a unique protected link for a customer
async function createProtectedLink(
  pdfBuffer: Buffer,
  customerId: string,
  maxViews: number,
  expiresInHours: number,
  deviceLock: boolean,
  screenShield: boolean,
  createdBy: string,
  producerWatermark?: { type: 'text' | 'image', content: string, opacity: number }
): Promise<{ viewerUrl: string; accessCode: string; docId: string }> {
  const docId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const accessCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  const supabase = getSupabase()
  
  // Upload PDF
  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(`${docId}.pdf`, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true
    })

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`)
  }

  // Create metadata
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()
  const metadata: Record<string, any> = {
    docId,
    accessCode,
    customerId,
    brand: "distribute",
    createdAt: new Date().toISOString(),
    createdBy,
    viewCount: 0,
    maxViews,
    expiresAt,
    deviceLock,
    screenShield,
  }

  // Add producer watermark if provided
  if (producerWatermark) {
    metadata.producerWatermark = producerWatermark
  }

  const { error: metaError } = await supabase.storage
    .from("pdfs")
    .upload(`${docId}.json`, Buffer.from(JSON.stringify(metadata)), {
      contentType: "application/json",
      upsert: true
    })

  if (metaError) {
    throw new Error(`Metadata upload failed: ${metaError.message}`)
  }

  const vercelUrl = process.env.VERCEL_URL || "http://localhost:3000"
  const viewerUrl = `${vercelUrl}/view/${docId}`

  return { viewerUrl, accessCode, docId }
}

// Data storage
const DATA_DIR = "./data"
const PAYMENTS_FILE = path.join(DATA_DIR, "payments.json")
const CONFIG_FILE = path.join(DATA_DIR, "config.json")

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

// Load/Save JSON helpers
function loadJson(filePath: string): any {
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"))
  }
  return {}
}

function saveJson(filePath: string, data: any): void {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2))
}

// Initialize data
let payments = loadJson(PAYMENTS_FILE)
let config = loadJson(CONFIG_FILE)

if (!config.log_channel_id) {
  config = { log_channel_id: null }
  saveJson(CONFIG_FILE, config)
}

// ============ PAYMENT INFO COMMAND ============
export const paymentInfoCommand = {
  data: new SlashCommandBuilder()
    .setName("paymentinfo")
    .setDescription("Show payment addresses for customers"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply()

    const currentBot = (process.env.BOT || "elyxbook").toLowerCase()

    if (currentBot === "clover") {
      const norz = new EmbedBuilder()
        .setColor(0x9B59B6)
        .setAuthor({ name: "Norz" })
        .addFields(
          { name: "◇ Solana", value: "```\nDbi51ZmSsmvpH3TuC2rTvayWqasBAsetWiuHRvwL1ELX\n```", inline: false },
          { name: "₿ Bitcoin", value: "```\nbc1qf89m8y00l0je8plp24uzr2lzx4cwm92pfxwgqp\n```", inline: false }
        )

      const ysl = new EmbedBuilder()
        .setColor(0x3498DB)
        .setAuthor({ name: "YSL" })
        .addFields(
          { name: "₿ Bitcoin", value: "```\nbc1p2709s2xhuvt337j9yf0ds7t664tsgtp94wwam4nx4n05ld98sljqem8v7r\n```", inline: false },
          { name: "◈ Solana", value: "```\n28ek6Za1q3NCvuSzCD74iDcPbNUTZAcrKtvzYYwdKPUW\n```", inline: false }
        )

      const footer = new EmbedBuilder()
        .setColor(0x2F3136)
        .setDescription("*After payment, send a screenshot in your ticket and wait for verification.*")

      await interaction.editReply({ embeds: [norz, ysl, footer] })
    } else {
      const embed = new EmbedBuilder()
        .setTitle("💳 Payment Information")
        .setDescription("Send payment to one of the addresses below:")
        .setColor(0xFFD700)
        .addFields(
          {
            name: "🌟 Asta Payment Info",
            value:
              "**Solana:**\n`Dbi51ZmSsmvpH3TuC2rTvayWqasBAsetWiuHRvwL1ELX`\n\n" +
              "**Bitcoin:**\n`bc1qf89m8y00l0je8plp24uzr2lzx4cwm92pfxwgqp`",
            inline: false
          },
          {
            name: "⚡ Yuno Payment Info",
            value:
              "**Solana:**\n`2KA3vSvw7YRLHxLgkfqYTwwRUPiy5vXezV9k9iDyezvH`\n\n" +
              "**Bitcoin:**\n`bc1qk0ajypt9h6g42lxgt8dccrywv5qce0mwtzlypt`",
            inline: false
          }
        )
        .setFooter({ text: "After payment, send a screenshot and wait for verification." })

      await interaction.editReply({ embeds: [embed] })
    }
  },
}

// Helper function to parse time string like "2h", "30m", "1d" into milliseconds
function parseTimeString(timeStr: string): number | null {
  const match = timeStr.match(/^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i)
  if (!match) return null
  
  const value = parseInt(match[1])
  const unit = match[2].toLowerCase()
  
  if (unit.startsWith('m')) return value * 60 * 1000 // minutes
  if (unit.startsWith('h')) return value * 60 * 60 * 1000 // hours
  if (unit.startsWith('d')) return value * 24 * 60 * 60 * 1000 // days
  return null
}

// Helper function to format time remaining
function formatTimeRemaining(dueAt: string): string {
  const now = Date.now()
  const due = new Date(dueAt).getTime()
  const diff = due - now
  
  if (diff <= 0) return "⚠️ OVERDUE"
  
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
  
  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    const remainingHours = hours % 24
    return `${days}d ${remainingHours}h`
  }
  
  return `${hours}h ${minutes}m`
}

// ============ PAID COMMAND ============
export const paidCommand = {
  data: new SlashCommandBuilder()
    .setName("paid")
    .setDescription("Mark ticket as paid and rename it")
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("The exam they paid for (e.g., SAT, ACT, AP)")
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName("customer")
        .setDescription("The customer who paid")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("time_before")
        .setDescription("Time until exam/deadline (e.g., 2h, 30m, 1d)")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }
    
    const channel = interaction.channel as TextChannel
    if (!channel || !("setName" in channel)) {
      await interaction.editReply({ content: "❌ This command can only be used in text channels." })
      return
    }

    const exam = interaction.options.getString("exam", true)
    const customer = interaction.options.getUser("customer", true)
    const timeBefore = interaction.options.getString("time_before", true)
    
    // Parse time
    const timeMs = parseTimeString(timeBefore)
    if (!timeMs) {
      await interaction.editReply({ 
        content: "❌ Invalid time format. Use formats like: `30m`, `2h`, `1d`"
      })
      return
    }
    
    const dueAt = new Date(Date.now() + timeMs).toISOString()
    
    // Format: EXAM-PAID-USERNAME
    const examClean = exam.toUpperCase().replace(/ /g, "-")
    const newName = `${examClean}-paid-${customer.username}`.toLowerCase()

    try {
      await channel.setName(newName)

      const embed = new EmbedBuilder()
        .setTitle("✅ Payment Verified")
        .setColor(0x00FF00)
        .addFields(
          { name: "Exam", value: exam.toUpperCase(), inline: true },
          { name: "Customer", value: `<@${customer.id}>`, inline: true },
          { name: "Verified By", value: `<@${interaction.user.id}>`, inline: true },
          { name: "⏰ Time to Distribute", value: timeBefore, inline: true }
        )
        .setTimestamp()

      await interaction.editReply({ embeds: [embed] })

      // Record payment by exam
      if (!payments.by_exam) payments.by_exam = {}
      if (!payments.by_exam[examClean]) payments.by_exam[examClean] = []

      payments.by_exam[examClean].push({
        user_id: customer.id,
        username: customer.username,
        display_name: customer.displayName || customer.username,
        verified_by: interaction.user.id,
        verified_at: new Date().toISOString(),
        time_until_exam: timeBefore,
        channel_id: channel.id
      })

      // Also keep user-based record
      if (!payments.by_user) payments.by_user = {}
      if (!payments.by_user[customer.id]) payments.by_user[customer.id] = []
      payments.by_user[customer.id].push({
        exam: examClean,
        verified_by: interaction.user.id,
        verified_at: new Date().toISOString(),
        time_until_exam: timeBefore
      })

      saveJson(PAYMENTS_FILE, payments)

      // Log to log channel
      if (config.log_channel_id) {
        const logChannel = interaction.client.channels.cache.get(config.log_channel_id) as TextChannel
        if (logChannel) {
          const totalForExam = payments.by_exam[examClean].length
          const logEmbed = new EmbedBuilder()
            .setTitle("💰 New Payment Recorded")
            .setColor(0xFFD700)
            .addFields(
              { name: "Exam", value: exam.toUpperCase(), inline: true },
              { name: "Customer", value: `<@${customer.id}>\n(${customer.username})`, inline: true },
              { name: "Verified By", value: `<@${interaction.user.id}>`, inline: true },
              { name: "Channel", value: `<#${channel.id}>`, inline: true },
              { name: "⏰ Time to Distribute", value: timeBefore, inline: true },
              { name: `Total ${exam.toUpperCase()} Sales`, value: String(totalForExam), inline: true }
            )
            .setTimestamp()
          await logChannel.send({ embeds: [logEmbed] })
        }
      }

    } catch (error) {
      await interaction.editReply({ content: "❌ I don't have permission to rename this channel." })
    }
  },
}

// ============ LIST COMMAND ============
export const listCommand = {
  data: new SlashCommandBuilder()
    .setName("list")
    .setDescription("List all customers who paid for a specific exam (sorted by due time)")
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("The exam to list customers for (e.g., SAT, ACT)")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply()
    const exam = interaction.options.getString("exam", true)
    const examKey = exam.toUpperCase().replace(/ /g, "-")

    // Reload payments from file
    payments = loadJson(PAYMENTS_FILE)

    if (!payments.by_exam || !payments.by_exam[examKey] || payments.by_exam[examKey].length === 0) {
      await interaction.editReply({ content: `❌ No customers found for **${exam.toUpperCase()}**.` })
      return
    }

    const customers = payments.by_exam[examKey]

    const embed = new EmbedBuilder()
      .setTitle(`📋 ${exam.toUpperCase()} - Customer List`)
      .setDescription(`Total: **${customers.length}** customer(s)`)
      .setColor(0x5865F2)

    // Build customer list with time until exam
    const customerList: string[] = []
    for (let i = 0; i < customers.length; i++) {
      const c = customers[i]
      const timeStr = c.time_until_exam || "Not set"
      const channelStr = c.channel_id ? ` • <#${c.channel_id}>` : ""
      
      customerList.push(`\`${i + 1}.\` **${c.display_name}** • ⏰ ${timeStr}${channelStr}`)
    }

    // Split into chunks if too long
    const chunkSize = 10
    for (let i = 0; i < customerList.length; i += chunkSize) {
      const chunk = customerList.slice(i, i + chunkSize)
      const fieldName = i === 0 ? "Customers" : "Customers (cont.)"
      embed.addFields({ name: fieldName, value: chunk.join("\n"), inline: false })
    }

    await interaction.editReply({ embeds: [embed] })
  },
}

// ============ CLEARLIST COMMAND ============
export const clearListCommand = {
  data: new SlashCommandBuilder()
    .setName("clearlist")
    .setDescription("Clear the customer list for a specific exam")
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("The exam to clear the list for")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply()
    const exam = interaction.options.getString("exam", true)
    const examKey = exam.toUpperCase().replace(/ /g, "-")

    // Reload payments from file
    payments = loadJson(PAYMENTS_FILE)

    if (!payments.by_exam || !payments.by_exam[examKey]) {
      await interaction.editReply({ content: `❌ No list found for **${exam.toUpperCase()}**.` })
      return
    }

    const count = payments.by_exam[examKey].length
    payments.by_exam[examKey] = []
    saveJson(PAYMENTS_FILE, payments)

    await interaction.editReply({ content: `✅ Cleared **${count}** customer(s) from the **${exam.toUpperCase()}** list.` })

    // Log the clear action
    if (config.log_channel_id) {
      const logChannel = interaction.client.channels.cache.get(config.log_channel_id) as TextChannel
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("🗑️ Customer List Cleared")
          .setColor(0xFF0000)
          .setDescription(`**Exam:** ${exam.toUpperCase()}\n**Cleared by:** <@${interaction.user.id}>\n**Customers removed:** ${count}`)
          .setTimestamp()
        await logChannel.send({ embeds: [logEmbed] })
      }
    }
  },
}

// ============ ALLEXAMS COMMAND ============
export const allExamsCommand = {
  data: new SlashCommandBuilder()
    .setName("allexams")
    .setDescription("Show all exams with customer counts"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply()
    // Reload payments from file
    payments = loadJson(PAYMENTS_FILE)

    if (!payments.by_exam || Object.keys(payments.by_exam).length === 0) {
      await interaction.editReply({ content: "❌ No payment records found." })
      return
    }

    const embed = new EmbedBuilder()
      .setTitle("📊 All Exams - Customer Counts")
      .setColor(0x5865F2)

    let total = 0
    for (const [examKey, customers] of Object.entries(payments.by_exam)) {
      const count = (customers as any[]).length
      total += count
      embed.addFields({ name: examKey, value: `${count} customer(s)`, inline: true })
    }

    embed.setFooter({ text: `Total across all exams: ${total}` })

    await interaction.editReply({ embeds: [embed] })
  },
}

// ============ DISTRIBUTE COMMAND ============
export const distributeCommand = {
  data: new SlashCommandBuilder()
    .setName("distribute")
    .setDescription("Distribute a message, file, or protected viewer links to all tickets of a specific exam")
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("The exam list to distribute to (e.g., SAT, ACT)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Distribution mode")
        .setRequired(true)
        .addChoices(
          { name: "Message/File (direct attachment)", value: "file" },
          { name: "Protected Links (unique viewer link per customer)", value: "links" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("message")
        .setDescription("The message to send with the distribution")
        .setRequired(false)
    )
    .addAttachmentOption((option) =>
      option
        .setName("pdf")
        .setDescription("PDF file to distribute (required for links mode)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("max_views")
        .setDescription("Max views per link (links mode only, default: 10)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addIntegerOption((option) =>
      option
        .setName("expires_in")
        .setDescription("Hours until links expire (links mode only, default: 24)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(720)
    )
    .addStringOption((option) =>
      option
        .setName("device_lock")
        .setDescription("Lock to single device (links mode only, default: locked)")
        .setRequired(false)
        .addChoices(
          { name: "Locked (single device)", value: "locked" },
          { name: "Unlocked (multiple devices)", value: "unlocked" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("screen_shield")
        .setDescription("Screen shield to prevent screenshots (links mode only, default: on)")
        .setRequired(false)
        .addChoices(
          { name: "On", value: "on" },
          { name: "Off", value: "off" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("watermark_text")
        .setDescription("Text watermark to overlay on PDF (links mode only)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("watermark_text_opacity")
        .setDescription("Opacity for text watermark 1-100 (default: 15)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addAttachmentOption((option) =>
      option
        .setName("watermark_image")
        .setDescription("Image watermark (logo) to overlay on PDF (links mode only)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("watermark_image_opacity")
        .setDescription("Opacity for image watermark 1-100 (default: 15)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) await interaction.deferReply()
    const exam = interaction.options.getString("exam", true)
    const mode = interaction.options.getString("mode", true)
    const message = interaction.options.getString("message")
    const pdfAttachment = interaction.options.getAttachment("pdf")
    const maxViews = interaction.options.getInteger("max_views") || 10
    const expiresIn = interaction.options.getInteger("expires_in") || 24
    const deviceLockOption = interaction.options.getString("device_lock") || "locked"
    const screenShieldOption = interaction.options.getString("screen_shield") || "on"
    const deviceLock = deviceLockOption === "locked"
    const screenShield = screenShieldOption === "on"
    
    // Watermark options
    const watermarkText = interaction.options.getString("watermark_text")
    const watermarkTextOpacity = interaction.options.getInteger("watermark_text_opacity") || 15
    const watermarkImage = interaction.options.getAttachment("watermark_image")
    const watermarkImageOpacity = interaction.options.getInteger("watermark_image_opacity") || 15
    
    // Build producer watermark config (text takes priority over image if both provided)
    let producerWatermark: { type: 'text' | 'image', content: string, opacity: number } | undefined
    
    if (watermarkText) {
      producerWatermark = {
        type: 'text',
        content: watermarkText,
        opacity: watermarkTextOpacity
      }
    } else if (watermarkImage) {
      // Download the watermark image and convert to base64
      const imageResponse = await fetch(watermarkImage.url)
      if (imageResponse.ok) {
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        const base64Image = imageBuffer.toString('base64')
        const mimeType = watermarkImage.contentType || 'image/png'
        producerWatermark = {
          type: 'image',
          content: `data:${mimeType};base64,${base64Image}`,
          opacity: watermarkImageOpacity
        }
      }
    }

    // Validate inputs based on mode
    if (mode === "links" && !pdfAttachment) {
      await interaction.editReply({ content: "❌ Links mode requires a PDF attachment." })
      return
    }

    if (mode === "file" && !message && !pdfAttachment) {
      await interaction.editReply({ content: "❌ Please provide a message or attach a file." })
      return
    }

    if (pdfAttachment && !pdfAttachment.name.toLowerCase().endsWith(".pdf")) {
      await interaction.editReply({ content: "❌ Only PDF files are supported for links mode." })
      return
    }

    const examKey = exam.toUpperCase().replace(/ /g, "-")
    const examPrefix = examKey.toLowerCase()

    // Find all ticket channels for this exam
    const matchingChannels: TextChannel[] = []
    const guild = interaction.guild
    if (!guild) {
      await interaction.editReply({ content: "❌ This command can only be used in a server." })
      return
    }

    for (const [, channel] of guild.channels.cache) {
      if (channel instanceof TextChannel) {
        if (channel.name.toLowerCase().startsWith(`${examPrefix}-paid`)) {
          matchingChannels.push(channel)
        }
      }
    }

    if (matchingChannels.length === 0) {
      await interaction.editReply({ 
        content: `❌ No paid tickets found for **${exam.toUpperCase()}**.\nLooking for channels starting with \`${examPrefix}-paid-\``
      })
      return
    }

    // Download PDF if provided
    let pdfBuffer: Buffer | null = null
    if (pdfAttachment) {
      const response = await fetch(pdfAttachment.url)
      pdfBuffer = Buffer.from(await response.arrayBuffer())
    }

    let successCount = 0
    const failedChannels: string[] = []
    const generatedLinks: { channel: string; customer: string; docId: string }[] = []

    if (mode === "links" && pdfBuffer) {
      // LINKS MODE: Create unique protected link for each customer
      await interaction.editReply({ content: `🔗 Generating ${matchingChannels.length} unique protected links...` })

      for (const channel of matchingChannels) {
        try {
          // Extract customer username from channel name (e.g., "sat-paid-johndoe" -> "johndoe")
          const channelName = channel.name
          const parts = channelName.split("-paid-")
          const customerName = parts.length > 1 ? parts[1] : channelName

          // Create unique protected link for this customer
          const { viewerUrl, accessCode, docId } = await createProtectedLink(
            pdfBuffer,
            customerName,
            maxViews,
            expiresIn,
            deviceLock,
            screenShield,
            interaction.user.username,
            producerWatermark
          )

          // Send to channel
          const lockStatus = deviceLock ? "🔒 Single device" : "🔓 Multi-device"
          const shieldStatus = screenShield ? "🛡️ Screen Shield: ON" : "🛡️ Screen Shield: OFF"

          const embed = new EmbedBuilder()
            .setTitle(`📦 ${exam.toUpperCase()} Materials`)
            .setDescription(message || "Here are your study materials!")
            .setColor(0x00FF00)
            .addFields(
              { name: "🔗 Viewer Link", value: viewerUrl, inline: false },
              { name: "🔑 Access Code", value: `\`${accessCode}\``, inline: true },
              { name: "⏱️ Expires", value: `${maxViews} views or ${expiresIn}h`, inline: true },
              { name: "Security", value: `${lockStatus}\n${shieldStatus}`, inline: false }
            )
            .setFooter({ text: `Doc ID: ${docId} | No downloads - view only!` })
            .setTimestamp()

          await channel.send({ embeds: [embed] })

          generatedLinks.push({ channel: channelName, customer: customerName, docId })
          successCount++

          // Update progress
          if (successCount % 5 === 0) {
            await interaction.editReply({ content: `🔗 Generated ${successCount}/${matchingChannels.length} links...` })
          }
        } catch (error) {
          console.error(`[distribute] Error for ${channel.name}:`, error)
          failedChannels.push(channel.name)
        }
      }
    } else {
      // FILE MODE: Send the same file to everyone
      for (const channel of matchingChannels) {
        try {
          const embed = new EmbedBuilder()
            .setTitle(`📦 ${exam.toUpperCase()} Materials`)
            .setDescription(message || "Here are your materials:")
            .setColor(0x00FF00)
            .setFooter({ text: `Distributed by ${interaction.user.displayName || interaction.user.username}` })

          if (pdfBuffer && pdfAttachment) {
            const file = new AttachmentBuilder(pdfBuffer, { name: pdfAttachment.name })
            await channel.send({ embeds: [embed], files: [file] })
          } else {
            await channel.send({ embeds: [embed] })
          }

          successCount++
        } catch (error) {
          failedChannels.push(channel.name)
        }
      }
    }

    // Report results
    let resultMsg = `✅ Successfully distributed to **${successCount}/${matchingChannels.length}** tickets for **${exam.toUpperCase()}**.`
    if (mode === "links") {
      resultMsg += `\n\n🔗 **Link Settings:**\n• Max views: ${maxViews}\n• Expires in: ${expiresIn}h\n• Device lock: ${deviceLock ? "Yes" : "No"}\n• Screen shield: ${screenShield ? "Yes" : "No"}`
    }
    if (failedChannels.length > 0) {
      resultMsg += `\n\n❌ Failed: ${failedChannels.slice(0, 5).join(", ")}`
      if (failedChannels.length > 5) {
        resultMsg += ` +${failedChannels.length - 5} more`
      }
    }

    await interaction.editReply({ content: resultMsg })

    // Log the distribution
    if (config.log_channel_id) {
      const logChannel = interaction.client.channels.cache.get(config.log_channel_id) as TextChannel
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle(mode === "links" ? "🔗 Protected Links Distributed" : "📤 Materials Distributed")
          .setColor(mode === "links" ? 0x5865F2 : 0x9B59B6)
          .addFields(
            { name: "Exam", value: exam.toUpperCase(), inline: true },
            { name: "Tickets", value: String(successCount), inline: true },
            { name: "Mode", value: mode === "links" ? "Protected Links" : "Direct File", inline: true },
            { name: "Distributed By", value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp()
        
        if (mode === "links") {
          let settingsValue = `Views: ${maxViews} | Hours: ${expiresIn} | Lock: ${deviceLock ? "Yes" : "No"} | Shield: ${screenShield ? "Yes" : "No"}`
          if (producerWatermark) {
            settingsValue += `\nWatermark: ${producerWatermark.type === 'text' ? `"${producerWatermark.content}"` : 'Image'} (${producerWatermark.opacity}%)`
          }
          logEmbed.addFields(
            { name: "Link Settings", value: settingsValue, inline: false }
          )
        }

        if (message) {
          logEmbed.addFields({ 
            name: "Message", 
            value: message.length > 100 ? message.slice(0, 100) + "..." : message, 
            inline: false 
          })
        }

        if (pdfAttachment) {
          logEmbed.addFields({ name: "File", value: pdfAttachment.name, inline: true })
        }
        
        await logChannel.send({ embeds: [logEmbed] })

        // If links mode, send detailed customer list
        if (mode === "links" && generatedLinks.length > 0) {
          // Build customer list in chunks (Discord has field limits)
          const customerListEmbed = new EmbedBuilder()
            .setTitle(`📋 ${exam.toUpperCase()} - Distributed Links Details`)
            .setColor(0x5865F2)
            .setDescription(`**Total:** ${generatedLinks.length} unique links generated`)
            .setTimestamp()

          // Create customer list text
          let customerList = ""
          for (let i = 0; i < generatedLinks.length; i++) {
            const link = generatedLinks[i]
            const line = `**${i + 1}.** ${link.customer}\n   └ Doc ID: \`${link.docId}\`\n`
            
            // Check if adding this line would exceed limit
            if (customerList.length + line.length > 1000) {
              customerListEmbed.addFields({ name: "Customers", value: customerList, inline: false })
              customerList = line
            } else {
              customerList += line
            }
          }
          
          // Add remaining customers
          if (customerList.length > 0) {
            customerListEmbed.addFields({ name: generatedLinks.length > 10 ? "Customers (cont.)" : "Customers", value: customerList, inline: false })
          }

          customerListEmbed.setFooter({ text: "Use /logs <doc_id> <access_code> to view access logs for any link" })

          await logChannel.send({ embeds: [customerListEmbed] })
        }
      }
    }
  },
}

// ============ SETLOGS COMMAND ============
export const setLogsCommand = {
  data: new SlashCommandBuilder()
    .setName("setlogs")
    .setDescription("Set the channel for logging payments and actions")
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to send logs to")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const channel = interaction.options.getChannel("channel", true)
    
    config.log_channel_id = channel.id
    saveJson(CONFIG_FILE, config)

    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true })
    }
    await interaction.editReply({ content: `✅ Log channel set to <#${channel.id}>` })
  },
}

// ============ GIVEVOUCH COMMAND ============
export const giveVouchCommand = {
  data: new SlashCommandBuilder()
    .setName("givevouch")
    .setDescription("Give the Voucher role to a customer or an entire exam list")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Give role to a single customer or an entire list")
        .setRequired(true)
        .addChoices(
          { name: "Single Customer", value: "customer" },
          { name: "Entire Exam List", value: "list" }
        )
    )
    .addUserOption((option) =>
      option
        .setName("customer")
        .setDescription("The customer to give the role to (for single customer mode)")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("exam")
        .setDescription("The exam list to give the role to (for list mode)")
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    const mode = interaction.options.getString("mode", true)
    const customer = interaction.options.getUser("customer")
    const exam = interaction.options.getString("exam")

    // Validate inputs
    if (mode === "customer" && !customer) {
      await interaction.editReply({ content: "❌ Please specify a customer for single customer mode." })
      return
    }

    if (mode === "list" && !exam) {
      await interaction.editReply({ content: "❌ Please specify an exam for list mode." })
      return
    }

    const guild = interaction.guild
    if (!guild) {
      await interaction.editReply({ content: "❌ This command can only be used in a server." })
      return
    }

    // Find the Voucher role (case-insensitive)
    const voucherRole = guild.roles.cache.find(
      role => role.name.toLowerCase() === "voucher" || role.name.toLowerCase() === "vouchers"
    )

    if (!voucherRole) {
      await interaction.editReply({ content: "❌ Could not find a role named 'Voucher' or 'Vouchers'. Please create one first." })
      return
    }

    let successCount = 0
    let failedCount = 0
    const failedUsers: string[] = []
    const successUsers: string[] = []

    if (mode === "customer" && customer) {
      // Single customer - give role
      try {
        const member = await guild.members.fetch(customer.id)
        await member.roles.add(voucherRole)
        successCount = 1
        successUsers.push(customer.username || customer.id)

        await interaction.editReply({ content: `✅ Gave **${voucherRole.name}** role to <@${customer.id}>` })
      } catch (error) {
        await interaction.editReply({ content: `❌ Failed to give role: ${error}` })
      }
    } else if (mode === "list" && exam) {
      // Entire exam list - give role to all
      const examKey = exam.toUpperCase().replace(/ /g, "-")
      
      // Reload payments
      const currentPayments = loadJson(PAYMENTS_FILE)
      
      if (!currentPayments.by_exam || !currentPayments.by_exam[examKey] || currentPayments.by_exam[examKey].length === 0) {
        await interaction.editReply({ content: `❌ No customers found for **${exam.toUpperCase()}**.` })
        return
      }

      const customers = currentPayments.by_exam[examKey]
      
      await interaction.editReply({ content: `🔄 Giving **${voucherRole.name}** role to ${customers.length} customers...` })

      for (const c of customers) {
        try {
          const member = await guild.members.fetch(c.user_id)
          await member.roles.add(voucherRole)
          successCount++
          successUsers.push(c.username || c.user_id)
        } catch (error) {
          failedCount++
          failedUsers.push(c.username || c.user_id)
        }
      }

      let resultMsg = `✅ Gave **${voucherRole.name}** role to **${successCount}/${customers.length}** customers from **${examKey}**`
      
      // List successful users
      if (successUsers.length > 0) {
        resultMsg += `\n\n**Customers:**\n`
        resultMsg += successUsers.map(u => `• ${u}`).join("\n")
      }
      
      if (failedCount > 0) {
        resultMsg += `\n\n❌ Failed (${failedCount}): ${failedUsers.slice(0, 5).join(", ")}`
        if (failedUsers.length > 5) {
          resultMsg += ` +${failedUsers.length - 5} more`
        }
      }

      await interaction.editReply({ content: resultMsg })
    }

    // Log the action
    if (config.log_channel_id && successCount > 0) {
      const logChannel = interaction.client.channels.cache.get(config.log_channel_id) as TextChannel
      if (logChannel) {
        const logEmbed = new EmbedBuilder()
          .setTitle("⭐ Voucher Role Given")
          .setColor(0xFFD700)
          .addFields(
            { name: "Mode", value: mode === "customer" ? "Single Customer" : "Exam List", inline: true },
            { name: "Target", value: mode === "customer" ? `<@${customer?.id}>` : exam?.toUpperCase() || "N/A", inline: true },
            { name: "Count", value: String(successCount), inline: true },
            { name: "Given By", value: `<@${interaction.user.id}>`, inline: true }
          )
          .setTimestamp()
        
        await logChannel.send({ embeds: [logEmbed] })
      }
    }
  },
}

