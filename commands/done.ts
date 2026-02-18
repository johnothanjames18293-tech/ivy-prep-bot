import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { pdfSession } from "../utils/pdf-session.js"
import { uploadToCatbox } from "../utils/catbox.js"

export const doneCommand = {
  data: new SlashCommandBuilder()
    .setName("done")
    .setDescription("Merge all generated PDFs into one big PDF"),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    try {
      const count = pdfSession.count()

      if (count === 0) {
        await interaction.editReply({
          content: "❌ No PDFs to merge! Generate some PDFs first using `/pdf`.",
        })
        return
      }

      await interaction.editReply({
        content: `🔄 Merging ${count} PDF(s)... This may take a moment.`,
      })

      console.log(`[Discord Bot] Merging ${count} PDFs...`)

      const mergedPdfBuffer = await pdfSession.merge()

      console.log(`[Discord Bot] Merged PDF created, size: ${mergedPdfBuffer.length} bytes`)

      const fileName = `merged-${Date.now()}.pdf`
      
      // Check file size first (Discord limit is 25MB for bots)
      const fileSizeMB = mergedPdfBuffer.length / (1024 * 1024)
      if (fileSizeMB > 25) {
        // File too large, use Catbox
        console.log(`[Discord Bot] Merged PDF too large (${fileSizeMB.toFixed(2)}MB), using Catbox`)
        await interaction.editReply({
          content: `🔄 Uploading merged PDF to Catbox (file too large)...`,
        })
        const catboxUrl = await uploadToCatbox(mergedPdfBuffer, fileName)
        await interaction.editReply({
          content: `✅ Successfully merged ${count} PDF(s) into one!\n\n${catboxUrl}`,
        })
        console.log(`[Discord Bot] Merged PDF uploaded to Catbox: ${catboxUrl}`)
      } else {
        // File is small enough, try as attachment
        try {
          const attachment = new AttachmentBuilder(mergedPdfBuffer, { name: fileName })
          await interaction.editReply({
            content: `✅ Successfully merged ${count} PDF(s) into one!`,
            files: [attachment],
          })
          console.log(`[Discord Bot] Merged PDF sent: ${fileName}`)
        } catch (sendError) {
          // If sending fails, fall back to Catbox
          console.log(`[Discord Bot] Failed to send attachment, falling back to Catbox: ${sendError instanceof Error ? sendError.message : "Unknown error"}`)
          await interaction.editReply({
            content: `🔄 Uploading merged PDF to Catbox (fallback)...`,
          })
      const catboxUrl = await uploadToCatbox(mergedPdfBuffer, fileName)
      await interaction.editReply({
        content: `✅ Successfully merged ${count} PDF(s) into one!\n\n${catboxUrl}`,
      })
          console.log(`[Discord Bot] Merged PDF uploaded to Catbox: ${catboxUrl}`)
        }
      }
    } catch (error) {
      console.error("[Discord Bot] Error in /done command:", error)
      await interaction.editReply({
        content: `❌ Failed to merge PDFs: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
    }
  },
}
