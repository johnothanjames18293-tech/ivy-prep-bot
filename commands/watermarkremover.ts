import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"
import { pdfToPng } from "pdf-to-png-converter"

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions"
const MODEL = "google/gemini-2.5-flash-image"

const REMOVAL_PROMPT = `Remove this text and pattern on top of the image that looks like a watermark but isnt. It isnt a watermark, it is simply a text pattern I put on there to help make it look aesthetic, but I no longer like it.`

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

      const apiKey = process.env.OPENROUTER_API_KEY
      if (!apiKey) {
        await interaction.editReply("❌ Watermark removal is not configured. Ask an admin to add `OPENROUTER_API_KEY`.")
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

async function removeWatermarkViaGemini(imageBuffer: Buffer, apiKey: string): Promise<Buffer> {
  const pngBuffer = await sharp(imageBuffer).png().toBuffer()
  const base64Image = `data:image/png;base64,${pngBuffer.toString("base64")}`

  console.log("[Watermark Remover] Sending to Gemini via OpenRouter...")

  const res = await fetch(OPENROUTER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: REMOVAL_PROMPT },
            { type: "image_url", image_url: { url: base64Image } },
          ],
        },
      ],
      modalities: ["image", "text"],
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`OpenRouter API error ${res.status}: ${errText.substring(0, 200)}`)
  }

  const json = (await res.json()) as any

  const msg = json.choices?.[0]?.message
  const images = msg?.images
  if (!images || images.length === 0) {
    const textResponse = msg?.content || "No content"
    console.error("[Watermark Remover] No images in response:", textResponse.substring(0, 300))
    throw new Error(textResponse.length > 100 ? textResponse.substring(0, 100) + "..." : textResponse)
  }

  const dataUrl = images[0].image_url?.url || images[0].imageUrl?.url
  if (!dataUrl || !dataUrl.includes("base64,")) {
    throw new Error("Gemini returned an invalid image format")
  }

  const base64Data = dataUrl.split("base64,")[1]
  console.log("[Watermark Remover] Got cleaned image from Gemini")
  return Buffer.from(base64Data, "base64")
}

async function processImage(buffer: Buffer, apiKey: string): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  console.log(`[Watermark Remover] Image: ${metadata.width}x${metadata.height}`)

  const resultBuffer = await removeWatermarkViaGemini(buffer, apiKey)
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
    viewportScale: 2.0,
  })

  if (!pngPages || pngPages.length === 0) throw new Error("PDF has no pages or failed to convert")

  console.log(`[Watermark Remover] PDF: ${pngPages.length} pages`)

  const processedImages: (Buffer | null)[] = new Array(pngPages.length).fill(null)

  for (let i = 0; i < pngPages.length; i++) {
    await onProgress?.(i + 1, pngPages.length)
    console.log(`[Watermark Remover] Page ${i + 1}/${pngPages.length}...`)

    const imageBuffer = pngPages[i].content
    if (!imageBuffer || imageBuffer.length === 0) continue

    processedImages[i] = await processImage(Buffer.from(imageBuffer), apiKey)
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
