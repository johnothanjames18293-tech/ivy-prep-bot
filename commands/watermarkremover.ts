import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"
import { pdfToPng } from "pdf-to-png-converter"
import FormData from "form-data"

const LIGHTPDF_API_BASE = "https://techhk.aoscdn.com/api/tasks/visual/external/watermark-remove"

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

      const apiKey = process.env.LIGHTPDF_API_KEY
      if (!apiKey) {
        await interaction.editReply("❌ Watermark removal is not configured. Ask an admin to add `LIGHTPDF_API_KEY`.")
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
        await interaction.editReply({ content: `🔄 Converting PDF pages...` })
        cleanedBuffer = await processPDF(buffer, apiKey, async (page, total) => {
          try {
            await interaction.editReply({ content: `🔄 Processing page ${page}/${total}...` })
          } catch {}
        })
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(ext)) {
        cleanedBuffer = await processImage(buffer, apiKey)
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

async function removeWatermarkViaLightPDF(imageBuffer: Buffer, apiKey: string): Promise<Buffer> {
  const pngBuffer = await sharp(imageBuffer).png().toBuffer()

  const form = new FormData()
  form.append("file", pngBuffer, { filename: "image.png", contentType: "image/png" })
  form.append("sync", "0")

  console.log("[Watermark Remover] Creating LightPDF task...")
  const createRes = await fetch(LIGHTPDF_API_BASE, {
    method: "POST",
    headers: { "X-API-KEY": apiKey },
    body: form as any,
  })

  const createJson = (await createRes.json()) as any
  if (createJson.status !== 200 || !createJson.data?.task_id) {
    throw new Error(`LightPDF task creation failed: ${createJson.message || JSON.stringify(createJson)}`)
  }

  const taskId = createJson.data.task_id
  console.log(`[Watermark Remover] Task created: ${taskId}, polling...`)

  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000))

    const pollRes = await fetch(`${LIGHTPDF_API_BASE}/${taskId}`, {
      headers: { "X-API-KEY": apiKey },
    })
    const pollJson = (await pollRes.json()) as any

    if (pollJson.status !== 200) {
      throw new Error(`LightPDF polling error: ${pollJson.message || JSON.stringify(pollJson)}`)
    }

    const { state } = pollJson.data
    if (state === 1) {
      const resultUrl = pollJson.data.file
      if (!resultUrl) throw new Error("LightPDF returned no file URL")
      console.log("[Watermark Remover] Done, downloading result...")
      const resultRes = await fetch(resultUrl)
      if (!resultRes.ok) throw new Error(`Failed to download result: ${resultRes.status}`)
      return Buffer.from(await resultRes.arrayBuffer())
    }
    if (state < 0) {
      throw new Error(`LightPDF processing failed (state: ${state})`)
    }
  }

  throw new Error("LightPDF processing timed out after 60s")
}

async function processImage(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  console.log(`[Watermark Remover] Image: ${metadata.width}x${metadata.height}`)

  const resultBuffer = await removeWatermarkViaLightPDF(buffer, apiKey)
  return await sharp(resultBuffer).png().toBuffer()
}

async function processPDF(
  buffer: Buffer,
  apiKey: string,
  onProgress?: (page: number, total: number) => Promise<void>
): Promise<Buffer> {
  const pngPages = await pdfToPng(buffer as unknown as ArrayBuffer, {
    disableFontFace: true,
    useSystemFonts: true,
    viewportScale: 1.5,
  })

  if (!pngPages || pngPages.length === 0) throw new Error("PDF has no pages or failed to convert")

  console.log(`[Watermark Remover] PDF: ${pngPages.length} pages`)

  // Process 2 pages at a time (LightPDF QPS limit is 2)
  const processedImages: (Buffer | null)[] = new Array(pngPages.length).fill(null)

  for (let i = 0; i < pngPages.length; i += 2) {
    const batch = pngPages.slice(i, i + 2)
    await onProgress?.(i + 1, pngPages.length)

    const results = await Promise.all(
      batch.map(async (page, j) => {
        const idx = i + j
        console.log(`[Watermark Remover] Page ${idx + 1}/${pngPages.length}...`)
        if (!page.content || page.content.length === 0) return null
        return processImage(Buffer.from(page.content), apiKey)
      })
    )
    results.forEach((r, j) => { processedImages[i + j] = r })
  }

  const newPdf = await PDFDocument.create()

  for (const processedImage of processedImages) {
    if (!processedImage) continue

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
