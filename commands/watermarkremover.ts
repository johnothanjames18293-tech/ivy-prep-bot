import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"
import Replicate from "replicate"
import { pdfToPng } from "pdf-to-png-converter"

export const watermarkremoverCommand = {
  data: new SlashCommandBuilder()
    .setName("watermarkremover")
    .setDescription("Remove watermarks from images and PDFs using AI")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("The file to remove watermarks from (PDF, PNG, JPG, WEBP)")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply()
      }

      const replicateApiKey = process.env.REPLICATE_API_TOKEN
      if (!replicateApiKey) {
        await interaction.editReply("❌ Watermark removal is not configured. Ask an admin to add `REPLICATE_API_TOKEN`.")
        return
      }

      const attachment = interaction.options.getAttachment("file")!

      if (!attachment.url) {
        await interaction.editReply("❌ Invalid file")
        return
      }

      await interaction.editReply({ content: `🔄 Processing ${attachment.name}...` })

      const response = await fetch(attachment.url)
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      const ext = path.extname(attachment.name).toLowerCase()
      const fileName = path.basename(attachment.name, ext)

      let cleanedBuffer: Buffer

      if (ext === ".pdf") {
        await interaction.editReply({ content: `🔄 Processing PDF pages... This may take a moment.` })
        cleanedBuffer = await processPDF(buffer, replicateApiKey)
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(ext)) {
        cleanedBuffer = await processImage(buffer, replicateApiKey)
      } else {
        await interaction.editReply({ content: `❌ Unsupported format: ${ext}. Use PDF, PNG, JPG, or WEBP.` })
        return
      }

      const outputExt = ext === ".pdf" ? ".pdf" : ".png"
      const outputName = `${fileName}_cleaned${outputExt}`
      const attachmentOutput = new AttachmentBuilder(cleanedBuffer, { name: outputName })

      await interaction.editReply({
        content: `✅ Watermarks removed!`,
        files: [attachmentOutput],
      })
    } catch (error: any) {
      console.error("[Watermark Remover] Error:", error)

      if (error.code === 10062 || error.message?.includes("Unknown interaction")) return

      try {
        await interaction.editReply({
          content: `❌ Error removing watermark: ${error instanceof Error ? error.message : "Unknown error"}`,
        })
      } catch (err: any) {
        if (err.code !== 10062) console.error("[Watermark Remover] Failed to send error:", err)
      }
    }
  },
}

async function processImage(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const replicate = new Replicate({ auth: apiKey })

  const pngBuffer = await sharp(buffer).png().toBuffer()
  const metadata = await sharp(pngBuffer).metadata()
  const width = metadata.width!
  const height = metadata.height!

  console.log(`[Watermark Remover] Image: ${width}x${height}`)

  const imageDataUri = `data:image/png;base64,${pngBuffer.toString("base64")}`

  // Build a mask of likely watermark pixels (light gray, semi-transparent looking)
  const { data } = await sharp(pngBuffer).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const maskData = Buffer.alloc(width * height)

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3]
    const g = data[i * 3 + 1]
    const b = data[i * 3 + 2]
    const brightness = (r + g + b) / 3
    const colorVariation = Math.max(r, g, b) - Math.min(r, g, b)

    // Light gray pixels in the watermark brightness range
    const isWatermark = colorVariation < 35 && brightness >= 150 && brightness <= 250
    maskData[i] = isWatermark ? 255 : 0
  }

  // Dilate the mask slightly to catch edges
  const dilatedMask = Buffer.alloc(width * height)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x
      let found = maskData[idx] > 0
      if (!found) {
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1 && !found; dx++) {
            if (maskData[(y + dy) * width + (x + dx)] > 0) found = true
          }
        }
      }
      dilatedMask[idx] = found ? 255 : 0
    }
  }

  const maskBuffer = await sharp(dilatedMask, { raw: { width, height, channels: 1 } }).png().toBuffer()
  const maskDataUri = `data:image/png;base64,${maskBuffer.toString("base64")}`

  console.log("[Watermark Remover] Calling Replicate LAMA...")

  const output = await replicate.run(
    "allenhooo/lama:cdac78a1bec5b23c07fd29692fb70baa513ea403a39e643c48ec5edadb15fe72",
    { input: { image: imageDataUri, mask: maskDataUri } }
  )

  console.log("[Watermark Remover] Replicate output type:", typeof output, output?.constructor?.name)

  // FileOutput.toString() reliably returns the URL string
  const resultUrl = String(output)
  if (!resultUrl.startsWith("http")) {
    console.error("[Watermark Remover] Unexpected output:", resultUrl.substring(0, 200))
    throw new Error("Replicate did not return a valid URL")
  }

  console.log("[Watermark Remover] Downloading result from:", resultUrl.substring(0, 80))
  const resultResponse = await fetch(resultUrl)
  if (!resultResponse.ok) throw new Error(`Failed to download result: ${resultResponse.status}`)
  const resultBuffer = Buffer.from(await resultResponse.arrayBuffer())

  return await sharp(resultBuffer).png().toBuffer()
}

async function processPDF(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const pngPages = await pdfToPng(buffer as unknown as ArrayBuffer, {
    disableFontFace: true,
    useSystemFonts: true,
    viewportScale: 2.0,
  })

  if (!pngPages || pngPages.length === 0) throw new Error("PDF has no pages or failed to convert")

  console.log(`[Watermark Remover] PDF: ${pngPages.length} pages`)

  const newPdf = await PDFDocument.create()

  for (let i = 0; i < pngPages.length; i++) {
    console.log(`[Watermark Remover] Page ${i + 1}/${pngPages.length}...`)

    const imageBuffer = pngPages[i].content
    if (!imageBuffer || imageBuffer.length === 0) continue

    const processedImage = await processImage(Buffer.from(imageBuffer), apiKey)

    const metadata = await sharp(processedImage).metadata()
    const w = metadata.width || 612
    const h = metadata.height || 792

    const pdfImage = await newPdf.embedPng(processedImage)
    const page = newPdf.addPage([w / 2, h / 2])
    page.drawImage(pdfImage, { x: 0, y: 0, width: w / 2, height: h / 2 })
  }

  if (newPdf.getPageCount() === 0) throw new Error("Failed to process any pages")

  return Buffer.from(await newPdf.save())
}
