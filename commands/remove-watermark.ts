import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"

export const removeWatermarkCommand = {
  data: new SlashCommandBuilder()
    .setName("remove-watermark")
    .setDescription("Remove watermark from a file")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("The file to remove watermark from")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    try {
      const attachment = interaction.options.getAttachment("file")!

      if (!attachment.url) {
        await interaction.editReply("❌ Invalid file")
        return
      }

      const response = await fetch(attachment.url)
      const buffer = await response.buffer()

      const ext = path.extname(attachment.name).toLowerCase()

      let cleanedBuffer: Buffer

      if (ext === ".pdf") {
        await interaction.editReply("⚠️ PDF watermark removal is complex. For images and PNGs, try uploading those instead.")
        return
      } else if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
        cleanedBuffer = await removeWatermarkFromImage(buffer)
      } else {
        try {
          cleanedBuffer = await removeWatermarkFromImage(buffer)
        } catch {
          await interaction.editReply("❌ Unsupported file format. Please use PNG or JPG.")
          return
        }
      }

      const outputName = `cleaned_${Date.now()}${ext}`
      const attachmentOutput = new AttachmentBuilder(cleanedBuffer, { name: outputName })

      await interaction.editReply({
        content: "✅ Watermark removed!",
        files: [attachmentOutput],
      })
    } catch (error) {
      console.error("[Discord Bot] Remove watermark error:", error)
      await interaction.editReply({
        content: `❌ Error removing watermark: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
    }
  },
}

async function removeWatermarkFromImage(buffer: Buffer): Promise<Buffer> {
  const image = sharp(buffer)
  const metadata = await image.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error("Could not determine image dimensions")
  }

  // <CHANGE> Extract raw pixel data and detect watermark regions
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true })

  const pixels = data
  const width = info.width
  const height = info.height
  const channels = info.channels

  const watermarkMask = new Uint8Array(pixels.length / channels)

  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i]
    const g = pixels[i + 1]
    const b = pixels[i + 2]

    const isGray = Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && Math.abs(r - b) < 20
    const isLight = r > 150 && r < 240

    watermarkMask[i / channels] = isGray && isLight ? 1 : 0
  }

  const cleaned = new Uint8Array(pixels)

  for (let i = 0; i < watermarkMask.length; i++) {
    if (watermarkMask[i] === 1) {
      const pixelIndex = i * channels
      let sumR = 0,
        sumG = 0,
        sumB = 0,
        count = 0

      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = (i % width) + dx
          const y = Math.floor(i / width) + dy

          if (x >= 0 && x < width && y >= 0 && y < height) {
            const neighborIdx = (y * width + x) * channels
            if (watermarkMask[y * width + x] === 0) {
              sumR += cleaned[neighborIdx]
              sumG += cleaned[neighborIdx + 1]
              sumB += cleaned[neighborIdx + 2]
              count++
            }
          }
        }
      }

      if (count > 0) {
        cleaned[pixelIndex] = Math.round(sumR / count)
        cleaned[pixelIndex + 1] = Math.round(sumG / count)
        cleaned[pixelIndex + 2] = Math.round(sumB / count)
      }
    }
  }

  return sharp(cleaned, {
    raw: {
      width: width,
      height: height,
      channels: channels,
    },
  }).toBuffer()
}
