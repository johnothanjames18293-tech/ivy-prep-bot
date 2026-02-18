import { SlashCommandBuilder, type ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { solveQuestions } from "../utils/question-solver.js"
import { createClient, SupabaseClient } from "@supabase/supabase-js"

let supabaseInstance: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    // Check both bot-specific and API variable names to ensure we use the same instance
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase credentials not configured. Need either SUPABASE_URL/SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_ANON_KEY')
    }
    
    console.log(`[getSupabase] Using Supabase URL: ${supabaseUrl.substring(0, 30)}...`)
    
    supabaseInstance = createClient(supabaseUrl, supabaseKey)
  }
  return supabaseInstance
}

async function uploadToCatbox(buffer: Buffer, filename: string): Promise<string> {
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/pdf" })
  const formData = new FormData()
  formData.append("reqtype", "fileupload")
  formData.append("fileToUpload", blob, filename)

  const response = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Catbox upload failed: ${response.status} - ${text}`)
  }

  const url = await response.text()
  return url.trim()
}

async function storeProtectedPdf(
  pdfBase64: string, 
  customerId: string, 
  brand: string,
  maxViews: number = 10,  // Default: 10 views
  expiresInHours: number = 3,  // Default: 3 hours
  deviceLock: boolean = true,  // Default: locked to single device
  createdBy: string = "unknown"  // Discord username who created the link
): Promise<{ viewerUrl: string; accessCode: string; docId: string }> {
  // Generate unique ID and access code
  const docId = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0')).join('')
  const accessCode = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  // Convert base64 to buffer
  const pdfBuffer = Buffer.from(pdfBase64, "base64")

  // Upload PDF directly to Supabase
  const supabase = getSupabase()
  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(`${docId}.pdf`, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true
    })

  if (uploadError) {
    throw new Error(`Supabase upload failed: ${uploadError.message}`)
  }

  // Calculate expiration time (defaults to 3 hours)
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString()

  // Upload metadata
  const metadata = {
    docId,
    accessCode,
    customerId: customerId || "unknown",
    brand: brand || "unknown",
    createdAt: new Date().toISOString(),
    createdBy: createdBy,  // Discord username who created the link
    viewCount: 0,
    maxViews: maxViews || null,
    expiresAt,
    deviceLock: deviceLock,  // true = locked to single device, false = multi-device allowed
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

async function deleteProtectedPdf(docId: string): Promise<boolean> {
  const supabase = getSupabase()
  
  try {
    // Download current metadata
    const { data: metaData, error: metaDownloadError } = await supabase.storage
      .from("pdfs")
      .download(`${docId}.json`)
    
    if (metaDownloadError || !metaData) {
      // If metadata doesn't exist, document might already be expired/deleted
      if (metaDownloadError?.message?.includes('not found') || metaDownloadError?.message?.includes('404')) {
        console.log(`[deleteProtectedPdf] Metadata not found - document may already be expired`)
        return true // Consider it "expired" if metadata doesn't exist
      }
      console.error(`[deleteProtectedPdf] ❌ Failed to download metadata: ${metaDownloadError?.message || 'Unknown error'}`)
      return false
    }
    
    // Parse and update metadata to mark as expired
    const text = await metaData.text()
    const metadata = JSON.parse(text)
    
    console.log(`[deleteProtectedPdf] Current metadata for ${docId}:`, {
      expired: metadata.expired,
      deletedAt: metadata.deletedAt,
      expiresAt: metadata.expiresAt
    })
    
    // Mark as expired - this will block access via the API
    metadata.expiresAt = new Date(0).toISOString() // Unix epoch (1970) - definitely expired
    metadata.expired = true
    metadata.deletedAt = new Date().toISOString()
    
    console.log(`[deleteProtectedPdf] Updating metadata for ${docId} with:`, {
      expired: metadata.expired,
      deletedAt: metadata.deletedAt,
      expiresAt: metadata.expiresAt
    })
    
    // Update metadata to mark as expired
    const metaBuffer = Buffer.from(JSON.stringify(metadata))
    const { error: updateError } = await supabase.storage
      .from("pdfs")
      .upload(`${docId}.json`, metaBuffer, {
        contentType: "application/json",
        upsert: true
      })
    
    if (updateError) {
      console.error(`[deleteProtectedPdf] ❌ Failed to mark as expired: ${updateError.message}`)
      return false
    }
    
    // Also delete the actual PDF file to prevent direct access
    console.log(`[deleteProtectedPdf] Attempting to delete PDF file: ${docId}.pdf`)
    const { error: pdfDeleteError } = await supabase.storage
      .from("pdfs")
      .remove([`${docId}.pdf`])
    
    if (pdfDeleteError) {
      console.error(`[deleteProtectedPdf] ⚠️ Failed to delete PDF file (may already be deleted): ${pdfDeleteError.message}`)
      // Don't fail the whole operation if PDF deletion fails - metadata update is more important
    } else {
      console.log(`[deleteProtectedPdf] ✅ Successfully deleted PDF file: ${docId}.pdf`)
    }
    
    // Wait for Supabase to propagate the update (3 seconds for eventual consistency)
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // Verify the update worked by downloading it back (try multiple times to ensure consistency)
    let verified = false
    for (let attempt = 0; attempt < 8; attempt++) {
      const { data: verifyData, error: verifyError } = await supabase.storage
        .from("pdfs")
        .download(`${docId}.json`)
      
      if (!verifyError && verifyData) {
        const verifyText = await verifyData.text()
        const verifyMetadata = JSON.parse(verifyText)
        
        // Check if expired flag OR deletedAt is set (either one indicates expiration)
        if (verifyMetadata.expired === true || verifyMetadata.deletedAt) {
          console.log(`[deleteProtectedPdf] ✅ Verified metadata update for ${docId} (attempt ${attempt + 1}):`, {
            expired: verifyMetadata.expired,
            deletedAt: verifyMetadata.deletedAt,
            expiresAt: verifyMetadata.expiresAt
          })
          verified = true
          break
        } else {
          console.log(`[deleteProtectedPdf] ⚠️ Verification attempt ${attempt + 1} - metadata not yet updated, retrying...`, {
            expired: verifyMetadata.expired,
            deletedAt: verifyMetadata.deletedAt
          })
          await new Promise(resolve => setTimeout(resolve, 1500))
        }
      } else {
        // If we can't download, wait and retry
        console.log(`[deleteProtectedPdf] ⚠️ Verification attempt ${attempt + 1} - download failed, retrying...`)
        await new Promise(resolve => setTimeout(resolve, 1500))
      }
    }
    
    if (!verified) {
      console.error(`[deleteProtectedPdf] ⚠️ Could not verify metadata update after 8 attempts - but update was sent successfully`)
      console.error(`[deleteProtectedPdf] ⚠️ This may be due to Supabase eventual consistency - expiration should take effect within a few seconds`)
      // Still return true because the update was sent successfully
      // The viewer will pick it up on the next check
    } else {
      console.log(`[deleteProtectedPdf] ✅ Verified - document ${docId} is now expired and inaccessible`)
    }
    
    console.log(`[deleteProtectedPdf] ✅ Successfully marked document ${docId} as expired - link will no longer work`)
    return true
  } catch (error) {
    console.error(`[deleteProtectedPdf] ❌ Exception: ${error}`)
    return false
  }
}

export const pdfCommand = {
  data: new SlashCommandBuilder()
    .setName("pdf")
    .setDescription("Generate SAT PDF from JSON files")
    .addAttachmentOption((option) => option.setName("file1").setDescription("JSON file 1").setRequired(true))
    .addStringOption((option) =>
      option
        .setName("brand")
        .setDescription("Choose PDF style")
        .setRequired(true)
        .addChoices(
          { name: "Ekon & Flux", value: "ekonflux" },
          { name: "Other SAT", value: "othersat" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("solver")
        .setDescription("Choose solving method")
        .setRequired(true)
        .addChoices(
          { name: "GrokSolver (SWAPI + Grok AI fallback)", value: "groksolver" },
          { name: "Grok (Grok AI only)", value: "grok" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("version")
        .setDescription("Choose question version")
        .setRequired(true)
        .addChoices(
          { name: "Original", value: "original" },
          { name: "Paraphrased (AI rewrites questions & wrong answers)", value: "paraphrased" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("Output mode: separate PDFs or combined bank")
        .setRequired(false)
        .addChoices(
          { name: "Separate (one PDF per file)", value: "separate" },
          { name: "Bank (combine all files into one PDF)", value: "bank" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("watermark")
        .setDescription("Watermark style (ONLY for Ekon & Flux - ignored if Other SAT)")
        .setRequired(false)
        .addChoices(
          { name: "Ekonflux", value: "ekon" },
          { name: "Himan", value: "himan" },
          { name: "YSL", value: "ysl" },
        ),
    )
    .addStringOption((option) =>
      option
        .setName("customer_id")
        .setDescription("Customer's Discord ID or username (for watermark tracking)")
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("delivery")
        .setDescription("How to deliver the PDF")
        .setRequired(false)
        .addChoices(
          { name: "Download Link (Catbox)", value: "download" },
          { name: "Protected Viewer (No download, requires code)", value: "protected" },
        ),
    )
    .addIntegerOption((option) =>
      option
        .setName("max_views")
        .setDescription("Max views before link expires (protected only)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addIntegerOption((option) =>
      option
        .setName("expires_in")
        .setDescription("Hours until link expires (protected only)")
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(720),
    )
    .addStringOption((option) =>
      option
        .setName("device_lock")
        .setDescription("Lock document to first device that opens it (protected only)")
        .setRequired(false)
        .addChoices(
          { name: "Locked (single device only)", value: "locked" },
          { name: "Unlocked (multiple devices allowed)", value: "unlocked" },
        ),
    )
    .addAttachmentOption((option) => option.setName("file2").setDescription("JSON file 2").setRequired(false))
    .addAttachmentOption((option) => option.setName("file3").setDescription("JSON file 3").setRequired(false))
    .addAttachmentOption((option) => option.setName("file4").setDescription("JSON file 4").setRequired(false))
    .addAttachmentOption((option) => option.setName("file5").setDescription("JSON file 5").setRequired(false)),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    try {
      const brand = interaction.options.getString("brand", true) as "ekonflux" | "othersat"
      const watermarkOption = interaction.options.getString("watermark") as "ekon" | "himan" | "ysl" | null
      const solverMode = interaction.options.getString("solver", true) as "groksolver" | "grok"
      const version = interaction.options.getString("version", true) as "original" | "paraphrased"
      const mode = interaction.options.getString("mode") || "separate"
      const customerId = interaction.options.getString("customer_id") || interaction.user.username
      const delivery = interaction.options.getString("delivery") || "download"
      const maxViews = interaction.options.getInteger("max_views") || undefined
      const expiresIn = interaction.options.getInteger("expires_in") || undefined
      const deviceLockOption = interaction.options.getString("device_lock") || "locked"
      const deviceLock = deviceLockOption === "locked"  // true = locked, false = unlocked
      const paraphrase = version === "paraphrased"

      const finalWatermark = brand === "othersat" ? "none" : (watermarkOption || "ekon")
      const brandLabel = brand === "ekonflux" ? "Ekon & Flux" : "Other SAT"
      const isProtected = delivery === "protected"

      const attachments = []
      for (let i = 1; i <= 5; i++) {
        const file = interaction.options.getAttachment(`file${i}`)
        if (file) {
          if (!file.name.endsWith(".json")) {
            await interaction.editReply({ content: `Error: File ${i} must be JSON.` })
            return
          }
          attachments.push({ file, index: i })
        }
      }

      if (attachments.length === 0) {
        await interaction.editReply({ content: "Error: No files uploaded." })
        return
      }

      const watermarkDisplay = brand === "othersat" ? "None (Clean)" : finalWatermark
      const modeDisplay = mode === "bank" ? "Bank (Combined)" : "Separate"
      const deliveryDisplay = isProtected ? "🔒 Protected Viewer" : "📥 Download Link"
      await interaction.editReply({
        content: `Processing ${attachments.length} file(s)...\nBrand: ${brandLabel}\nMode: ${modeDisplay}\nDelivery: ${deliveryDisplay}\nWatermark: ${watermarkDisplay}\nParaphrase: ${paraphrase ? "Yes" : "No"}`,
      })

      const webAppUrl = process.env.WEB_APP_URL || "http://localhost:3000"

      // BANK MODE: Combine all files into one PDF
      if (mode === "bank") {
        try {
          await interaction.editReply({ content: `Processing ${attachments.length} files for bank mode...\nBrand: ${brandLabel}` })

          // Solve all files first
          const allSolvedData: any[] = []
          for (const { file, index } of attachments) {
            await interaction.editReply({ content: `Solving file ${index}/${attachments.length}: ${file.name}...` })
            const response = await fetch(file.url)
            const testData = await response.json()
            const solvedTestData = await solveQuestions(testData, solverMode, paraphrase)
            allSolvedData.push(solvedTestData)
          }

          await interaction.editReply({ content: `Generating combined bank PDF with ${attachments.length} tests...` })

          const pdfResponse = await fetch(`${webAppUrl}/api/generate-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              testData: allSolvedData,
              watermarkMode: finalWatermark,
              brand: brand,
              customerId: customerId,
              bankMode: true,
            }),
          })

          if (!pdfResponse.ok) {
            const errorText = await pdfResponse.text()
            throw new Error(`PDF failed: ${errorText.substring(0, 200)}`)
          }

          const pdfJson = await pdfResponse.json()
          if (!pdfJson.success || !pdfJson.pdf) throw new Error("No PDF data returned")

          const pdfFilename = `question-bank-${attachments.length}tests-${brandLabel.replace(/ /g, "_")}.pdf`

          if (isProtected) {
            await interaction.editReply({ content: `Creating protected viewer for ${pdfFilename}...` })
            const { viewerUrl, accessCode, docId } = await storeProtectedPdf(pdfJson.pdf, customerId, brand, maxViews, expiresIn, deviceLock, interaction.user.username)
            
            const expireHours = expiresIn || 3
            const viewLimit = maxViews || 10
            const lockText = deviceLock ? "🔒 Single device" : "🔓 Multi-device"
            const limitText = `\n⏱️ Expires: ${viewLimit} views or ${expireHours}h\n${lockText}`
            
            await interaction.editReply({ 
              content: `✅ Generated Protected Question Bank!\n\n**${attachments.length} tests combined**\n\n🔗 **Viewer Link:** ${viewerUrl}\n🔑 **Access Code:** \`${accessCode}\`${limitText}\n🆔 Doc ID: \`${docId}\`\n\n⚠️ Share the code separately from the link for security.\n📋 No downloading - view only!\n\n💡 Use \`/expire ${docId}\` to delete this link` 
            })
          } else {
            const pdfBuffer = Buffer.from(pdfJson.pdf, "base64")
            
            // Check file size first (Discord limit is 25MB for bots)
            const fileSizeMB = pdfBuffer.length / (1024 * 1024)
            if (fileSizeMB > 25) {
              // File too large, use Catbox
              console.log(`[Discord Bot] Bank PDF too large (${fileSizeMB.toFixed(2)}MB), using Catbox`)
              await interaction.editReply({ content: `Uploading ${pdfFilename} to Catbox (file too large)...` })
              const catboxUrl = await uploadToCatbox(pdfBuffer, pdfFilename)
              await interaction.editReply({ 
                content: `✅ Generated Question Bank PDF!\n\n**${attachments.length} tests combined**\n${catboxUrl}` 
              })
            } else {
              // File is small enough, try as attachment
              try {
                const attachment = new AttachmentBuilder(pdfBuffer, { name: pdfFilename })
                await interaction.editReply({ 
                  content: `✅ Generated Question Bank PDF!\n\n**${attachments.length} tests combined**`,
                  files: [attachment]
                })
              } catch (sendError) {
                // If sending fails, fall back to Catbox
                console.log(`[Discord Bot] Failed to send attachment, falling back to Catbox: ${sendError instanceof Error ? sendError.message : "Unknown error"}`)
                await interaction.editReply({ content: `Uploading ${pdfFilename} to Catbox (fallback)...` })
            const catboxUrl = await uploadToCatbox(pdfBuffer, pdfFilename)
            await interaction.editReply({ 
              content: `✅ Generated Question Bank PDF!\n\n**${attachments.length} tests combined**\n${catboxUrl}` 
            })
              }
            }
          }

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "Unknown error"
          await interaction.editReply({ content: `Bank generation failed: ${errMsg.substring(0, 1800)}` })
        }
        return
      }

      // SEPARATE MODE: Generate one PDF per file
      const pdfAttachments: AttachmentBuilder[] = []
      const pdfLinks: string[] = []
      const errors: string[] = []

      for (const { file, index } of attachments) {
        try {
          await interaction.editReply({ content: `Processing file ${index}: ${file.name}...\nBrand: ${brandLabel}` })

          const response = await fetch(file.url)
          const testData = await response.json()

          const solvedTestData = await solveQuestions(testData, solverMode, paraphrase)
          
          const pdfResponse = await fetch(`${webAppUrl}/api/generate-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              testData: solvedTestData,
              watermarkMode: finalWatermark,
              brand: brand,
              customerId: customerId,
            }),
          })

          if (!pdfResponse.ok) {
            const errorText = await pdfResponse.text()
            const shortError = errorText.length > 200 ? errorText.substring(0, 200) + "..." : errorText
            throw new Error(`PDF failed: ${shortError}`)
          }

          const pdfJson = await pdfResponse.json()
          if (!pdfJson.success || !pdfJson.pdf) throw new Error("No PDF data returned")

          const originalName = file.name.replace(".json", "")
          const pdfFilename = `${originalName}-${brandLabel.replace(/ /g, "_")}-${version}.pdf`

          if (isProtected) {
            await interaction.editReply({ content: `Creating protected viewer for ${pdfFilename}...` })
            const { viewerUrl, accessCode, docId } = await storeProtectedPdf(pdfJson.pdf, customerId, brand, maxViews, expiresIn, deviceLock, interaction.user.username)
            const expireHours = expiresIn || 3
            const viewLimit = maxViews || 10
            const lockText = deviceLock ? "🔒" : "🔓"
            const limitText = ` (${viewLimit} views, ${expireHours}h, ${lockText})`
            pdfLinks.push(`**${originalName}**\n🔗 ${viewerUrl}\n🔑 Code: \`${accessCode}\`${limitText}\n🆔 \`${docId}\``)
          } else {
            const pdfBuffer = Buffer.from(pdfJson.pdf, "base64")
            
            // Check file size first (Discord limit is 25MB for bots)
            const fileSizeMB = pdfBuffer.length / (1024 * 1024)
            if (fileSizeMB > 25) {
              // File too large, use Catbox
              console.log(`[Discord Bot] File ${originalName} too large (${fileSizeMB.toFixed(2)}MB), using Catbox`)
              await interaction.editReply({ content: `Uploading ${pdfFilename} to Catbox (file too large)...` })
            const catboxUrl = await uploadToCatbox(pdfBuffer, pdfFilename)
            pdfLinks.push(`**${originalName}**: ${catboxUrl}`)
            } else {
              // File is small enough, try as attachment
              const attachment = new AttachmentBuilder(pdfBuffer, { name: pdfFilename })
              pdfAttachments.push(attachment)
              pdfLinks.push(`**${originalName}**`)
            }
          }

        } catch (error) {
          const errMsg = error instanceof Error ? error.message : "Unknown error"
          errors.push(`File ${index}: ${errMsg.substring(0, 150)}`)
        }
      }

      let finalMessage = ""
      const totalPdfs = pdfLinks.length + pdfAttachments.length
      if (totalPdfs > 0) {
        if (isProtected) {
          finalMessage = `🔒 Generated ${pdfLinks.length} Protected ${brandLabel} PDF(s)!\n\n${pdfLinks.join("\n\n")}\n\n⚠️ Share codes separately for security. No downloads allowed!`
        } else {
          // Combine attachment names and Catbox links
          const attachmentNames = pdfAttachments.map((_, i) => pdfLinks[i] || `PDF ${i + 1}`).filter(Boolean)
          const catboxLinks = pdfLinks.slice(pdfAttachments.length)
          const allLinks = [...attachmentNames, ...catboxLinks]
          finalMessage = `✅ Generated ${totalPdfs} ${brandLabel} PDF(s)!\n\n${allLinks.join("\n")}`
        }
        if (errors.length > 0) {
          finalMessage += `\n\nErrors:\n${errors.join("\n")}`
        }
      } else {
        finalMessage = `All files failed:\n${errors.join("\n")}`
      }

      if (finalMessage.length > 1900) {
        finalMessage = finalMessage.substring(0, 1900) + "..."
      }

      // Send attachments if we have any (Discord allows up to 10 files per message)
      const filesToSend = pdfAttachments.slice(0, 10)
      try {
        await interaction.editReply({ 
          content: finalMessage,
          files: filesToSend.length > 0 ? filesToSend : undefined
        })
        
        // If we have more than 10 files, send the rest in follow-up messages
        if (pdfAttachments.length > 10) {
          for (let i = 10; i < pdfAttachments.length; i += 10) {
            const batch = pdfAttachments.slice(i, i + 10)
            await interaction.followUp({ files: batch })
          }
        }
      } catch (sendError) {
        // If sending attachments fails, try without attachments
        console.log(`[Discord Bot] Failed to send attachments, sending message only: ${sendError instanceof Error ? sendError.message : "Unknown error"}`)
      await interaction.editReply({ content: finalMessage })
      }

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown"
      await interaction.editReply({ content: `Error: ${errMsg.substring(0, 1900)}` })
    }
  },
}

// Expire command to expire protected PDF links
export const expireCommand = {
  data: new SlashCommandBuilder()
    .setName("expire")
    .setDescription("Expire a protected PDF link (makes it inaccessible)")
    .addStringOption((option) =>
      option
        .setName("doc_id")
        .setDescription("The document ID to expire (shown when creating protected link)")
        .setRequired(true),
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true })
    }

    try {
      const docId = interaction.options.getString("doc_id", true)
      
      console.log(`[expire] Attempting to expire document: ${docId}`)
      const success = await deleteProtectedPdf(docId)
      
      if (success) {
        await interaction.editReply({ content: `✅ Document \`${docId}\` has been expired. The link will no longer work - users will see "This document has been deleted" when trying to access it.` })
        console.log(`[expire] Successfully expired document: ${docId}`)
      } else {
        await interaction.editReply({ content: `❌ Failed to expire document \`${docId}\`. It may not exist or was already expired. Check bot logs for details.` })
        console.error(`[expire] Failed to expire document: ${docId}`)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error"
      console.error(`[expire] Exception: ${errMsg}`, error)
      await interaction.editReply({ content: `❌ Error: ${errMsg}` })
    }
  },
}
