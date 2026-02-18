import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js"
import { createClient, SupabaseClient } from "@supabase/supabase-js"

let supabaseInstance: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    // Check both bot-specific and API variable names to ensure we use the same instance
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('[getSupabase] Missing Supabase credentials!')
      console.error('[getSupabase] SUPABASE_URL:', supabaseUrl ? 'Set' : 'NOT SET')
      console.error('[getSupabase] SUPABASE_ANON_KEY:', supabaseKey ? 'Set' : 'NOT SET')
      throw new Error('Supabase credentials not configured. Need either SUPABASE_URL/SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY in .env file')
    }
    
    console.log(`[getSupabase] Initializing Supabase client with URL: ${supabaseUrl.substring(0, 30)}...`)
    supabaseInstance = createClient(supabaseUrl, supabaseKey)
  }
  return supabaseInstance
}

async function storeProtectedPdfFromBuffer(
  pdfBuffer: Buffer,
  customerId: string,
  maxViews: number = 10,
  expiresInHours: number = 3,
  deviceLock: boolean = true,
  screenShield: boolean = true,
  createdBy: string = "unknown",
  producerWatermark?: { type: 'text' | 'image', content: string, opacity: number }
): Promise<{ viewerUrl: string; accessCode: string; docId: string }> {
  // Generate unique ID and access code
  const docId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const accessCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  // Upload PDF directly to Supabase
  const supabase = getSupabase()
  console.log(`[upload] Attempting to upload PDF to Supabase: ${docId}.pdf (${pdfBuffer.length} bytes)`)
  
  try {
    const { error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(`${docId}.pdf`, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true
      })

    if (uploadError) {
      console.error(`[upload] Supabase upload error:`, uploadError)
      throw new Error(`Supabase upload failed: ${uploadError.message}`)
    }
    
    console.log(`[upload] ✅ Successfully uploaded PDF to Supabase: ${docId}.pdf`)
  } catch (error: any) {
    console.error(`[upload] Exception during PDF upload:`, error)
    // Check if it's a network/credentials error
    if (error.message?.includes('fetch failed') || error.message?.includes('NetworkError') || error.cause?.code === 'ENOTFOUND' || error.cause?.code === 'ECONNREFUSED') {
      throw new Error(`Supabase connection failed. Please check your SUPABASE_URL and SUPABASE_ANON_KEY environment variables in .env file. Error: ${error.message}`)
    }
    throw error
  }

  // Calculate expiration time
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()

  // Upload metadata
  const metadata: Record<string, any> = {
    docId,
    accessCode,
    customerId: customerId || "unknown",
    brand: "upload", // Mark as direct upload
    createdAt: new Date().toISOString(),
    createdBy: createdBy,  // Discord username who created the link
    viewCount: 0,
    maxViews: maxViews || null,
    expiresAt,
    deviceLock: deviceLock,  // true = locked to single device, false = multi-device allowed
    screenShield: screenShield,  // true = screen shield enabled, false = disabled
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

export const uploadCommand = {
  data: new SlashCommandBuilder()
    .setName("upload")
    .setDescription("Upload any PDF to the protected viewer (view-only, no downloads)")
    .addAttachmentOption((option) =>
      option
        .setName("pdf")
        .setDescription("The PDF file to protect")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("customer_id")
        .setDescription("Customer's Discord ID or username (for tracking)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("max_views")
        .setDescription("Max views before link expires (default: 10)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addIntegerOption((option) =>
      option
        .setName("expires_in")
        .setDescription("Hours until link expires (default: 3)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(720) // 30 days max
    )
    .addStringOption((option) =>
      option
        .setName("device_lock")
        .setDescription("Lock to single device or allow multiple (default: locked)")
        .setRequired(false)
        .addChoices(
          { name: "Locked (single device only)", value: "locked" },
          { name: "Unlocked (multiple devices allowed)", value: "unlocked" },
        )
    )
    .addStringOption((option) =>
      option
        .setName("screen_shield")
        .setDescription("Screen Shield blocks part of view to prevent screenshots (default: on)")
        .setRequired(false)
        .addChoices(
          { name: "On (blocks top/bottom of screen)", value: "on" },
          { name: "Off (full view, easier to screenshot)", value: "off" },
        )
    )
    .addStringOption((option) =>
      option
        .setName("watermark_text")
        .setDescription("Producer watermark text (optional - your brand/logo text)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("watermark_text_opacity")
        .setDescription("Opacity for text watermark (1-100, default: 15)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .addAttachmentOption((option) =>
      option
        .setName("watermark_image")
        .setDescription("Producer watermark image (optional - your logo image)")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("watermark_image_opacity")
        .setDescription("Opacity for image watermark (1-100, default: 15)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    try {
      const pdfFile = interaction.options.getAttachment("pdf", true)
      const customerId = interaction.options.getString("customer_id") || interaction.user.username
      const maxViews = interaction.options.getInteger("max_views") || 10
      const expiresIn = interaction.options.getInteger("expires_in") || 3
      const deviceLockOption = interaction.options.getString("device_lock") || "locked"
      const deviceLock = deviceLockOption === "locked"
      const screenShieldOption = interaction.options.getString("screen_shield") || "on"
      const screenShield = screenShieldOption === "on"
      
      // Producer watermark options
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

      // Validate file is a PDF
      if (!pdfFile.name.toLowerCase().endsWith(".pdf")) {
        await interaction.editReply({
          content: "❌ Error: Please upload a PDF file (must end with .pdf)"
        })
        return
      }

      // Check file size (limit to 100MB)
      const fileSizeMB = pdfFile.size / (1024 * 1024)
      if (fileSizeMB > 100) {
        await interaction.editReply({
          content: `❌ Error: File too large (${fileSizeMB.toFixed(1)}MB). Maximum size is 100MB.`
        })
        return
      }

      await interaction.editReply({
        content: `📤 Uploading **${pdfFile.name}** to protected viewer...`
      })

      // Download the PDF file
      const response = await fetch(pdfFile.url)
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const pdfBuffer = Buffer.from(arrayBuffer)

      await interaction.editReply({
        content: `🔒 Creating protected viewer for **${pdfFile.name}**...`
      })

      // Store in protected viewer
      const { viewerUrl, accessCode, docId } = await storeProtectedPdfFromBuffer(
        pdfBuffer,
        customerId,
        maxViews,
        expiresIn,
        deviceLock,
        screenShield,
        interaction.user.username,
        producerWatermark
      )

      const lockStatus = deviceLock ? "🔒 Single device" : "🔓 Multi-device"
      const shieldStatus = screenShield ? "🛡️ Screen Shield: ON" : "🛡️ Screen Shield: OFF"
      const watermarkStatus = producerWatermark 
        ? `🏷️ Producer Watermark: ${producerWatermark.type === 'text' ? `"${producerWatermark.content}"` : 'Image'} (${producerWatermark.opacity}% opacity)`
        : ""
      const limitText = `\n⏱️ Expires: ${maxViews} views or ${expiresIn}h\n${lockStatus}\n${shieldStatus}${watermarkStatus ? '\n' + watermarkStatus : ''}`

      await interaction.editReply({
        content: `✅ **PDF Protected Successfully!**\n\n📄 **${pdfFile.name}**\n\n🔗 **Viewer Link:** ${viewerUrl}\n🔑 **Access Code:** \`${accessCode}\`${limitText}\n🆔 Doc ID: \`${docId}\`\n\n⚠️ Share the code separately from the link for security.\n📋 **No downloading** - view only!\n\n💡 Use \`/expire ${docId}\` to delete this link\n💡 Use \`/unbind ${docId}\` to reset device lock`
      })

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error"
      await interaction.editReply({
        content: `❌ Upload failed: ${errMsg.substring(0, 1800)}`
      })
    }
  },
}
