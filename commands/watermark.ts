import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"
import { getPreset, getPresetLogoBuffer } from "./preset.js"

export const watermarkCommand = {
  data: new SlashCommandBuilder()
    .setName("watermark")
    .setDescription("Add text and/or logo watermarks to any file (PDF, images, etc.)")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("The file to watermark (supports PDF, PNG, JPG, JPEG, WEBP, GIF, etc.)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("text1")
        .setDescription("Watermark text 1")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("text2")
        .setDescription("Watermark text 2")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("text3")
        .setDescription("Watermark text 3")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("text4")
        .setDescription("Watermark text 4")
        .setRequired(false)
    )
    .addStringOption((option) =>
      option
        .setName("text5")
        .setDescription("Watermark text 5")
        .setRequired(false)
    )
    .addAttachmentOption((option) =>
      option
        .setName("logo")
        .setDescription("Logo image to use as watermark (PNG, JPG, WEBP)")
        .setRequired(false)
    )
    .addNumberOption((option) =>
      option
        .setName("logo_opacity")
        .setDescription("Logo opacity (0.05 to 1.0, default: 0.15)")
        .setRequired(false)
        .setMinValue(0.05)
        .setMaxValue(1.0)
    )
    .addStringOption((option) =>
      option
        .setName("position")
        .setDescription("Text watermark position (logo is always centered)")
        .setRequired(false)
        .addChoices(
          { name: "Diagonal (repeating)", value: "diagonal" },
          { name: "Center", value: "center" },
          { name: "Bottom Right", value: "bottom-right" },
          { name: "Top Left", value: "top-left" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("color")
        .setDescription("Text watermark color")
        .setRequired(false)
        .addChoices(
          { name: "Neon Orange", value: "neon-orange" },
          { name: "Red", value: "red" },
          { name: "Orange", value: "orange" },
          { name: "Yellow", value: "yellow" },
          { name: "Lime Green", value: "lime" },
          { name: "Green", value: "green" },
          { name: "Cyan", value: "cyan" },
          { name: "Blue", value: "blue" },
          { name: "Navy Blue", value: "navy" },
          { name: "Purple", value: "purple" },
          { name: "Magenta", value: "magenta" },
          { name: "Pink", value: "pink" },
          { name: "Hot Pink", value: "hot-pink" },
          { name: "Gold", value: "gold" },
          { name: "Silver", value: "silver" },
          { name: "Teal", value: "teal" },
          { name: "Turquoise", value: "turquoise" },
          { name: "Coral", value: "coral" },
          { name: "Crimson", value: "crimson" },
          { name: "Violet", value: "violet" },
          { name: "Indigo", value: "indigo" },
          { name: "Maroon", value: "maroon" },
          { name: "Olive", value: "olive" },
          { name: "Gray", value: "gray" },
          { name: "Black", value: "black" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("preset")
        .setDescription("Use a saved preset (overridden by any options you also set)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addNumberOption((option) =>
      option
        .setName("opacity")
        .setDescription("Text watermark opacity (0.1 to 1.0, default: 0.15)")
        .setRequired(false)
        .setMinValue(0.1)
        .setMaxValue(1.0)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }

    try {
      // Load preset if specified
      const presetName = interaction.options.getString("preset")
      const preset = presetName ? getPreset(presetName) : null
      if (presetName && !preset) {
        await interaction.editReply(`❌ Preset "${presetName}" not found. Use \`/preset list\` to see available presets.`)
        return
      }

      // Collect texts: manual options override preset
      const manualTexts: string[] = []
      for (let i = 1; i <= 5; i++) {
        const t = interaction.options.getString(`text${i}`)
        if (t) manualTexts.push(t)
      }
      const watermarkTexts = manualTexts.length > 0 ? manualTexts : (preset?.texts || [])

      const logoAttachment = interaction.options.getAttachment("logo")
      const hasPresetLogo = !!(preset?.logoFile)

      if (watermarkTexts.length === 0 && !logoAttachment && !hasPresetLogo) {
        await interaction.editReply("❌ Provide at least one watermark text, a logo image, or use a preset.")
        return
      }

      const attachment = interaction.options.getAttachment("file")!
      const position = (interaction.options.getString("position") || preset?.position || "diagonal") as "diagonal" | "center" | "bottom-right" | "top-left"
      const colorOption = interaction.options.getString("color") || preset?.color || "neon-orange"
      const textOpacity = interaction.options.getNumber("opacity") || preset?.textOpacity || 0.15
      const logoOpacity = interaction.options.getNumber("logo_opacity") || preset?.logoOpacity || 0.15

      if (!attachment.url) {
        await interaction.editReply("❌ Invalid file")
        return
      }

      const parts: string[] = []
      if (watermarkTexts.length > 0) parts.push("text")
      if (logoAttachment || hasPresetLogo) parts.push("logo")
      const presetLabel = preset ? ` (preset: ${preset.name})` : ""
      await interaction.editReply({ content: `🔄 Adding ${parts.join(" + ")} watermark${presetLabel}...` })

      const response = await fetch(attachment.url)
      let buffer: Buffer
      if (response.arrayBuffer) {
        buffer = Buffer.from(await response.arrayBuffer())
      } else {
        buffer = await (response as any).buffer()
      }

      // Logo: manual attachment takes priority over preset logo
      let logoBuffer: Buffer | null = null
      if (logoAttachment) {
        const logoResponse = await fetch(logoAttachment.url)
        if (logoResponse.arrayBuffer) {
          logoBuffer = Buffer.from(await logoResponse.arrayBuffer())
        } else {
          logoBuffer = await (logoResponse as any).buffer()
        }
        logoBuffer = await sharp(logoBuffer!)
          .resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer()
      } else if (preset) {
        logoBuffer = getPresetLogoBuffer(preset)
      }

      const ext = path.extname(attachment.name).toLowerCase()
      const fileName = path.basename(attachment.name, ext)

      let watermarkedBuffer: Buffer

      const opts: WatermarkOptions = {
        texts: watermarkTexts,
        logoBuffer,
        position,
        colorOption,
        textOpacity,
        logoOpacity,
      }

      if (ext === ".pdf") {
        watermarkedBuffer = await addWatermarkToPDF(buffer, opts)
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(ext)) {
        watermarkedBuffer = await addWatermarkToImage(buffer, opts)
      } else {
        try {
          watermarkedBuffer = await addWatermarkToImage(buffer, opts)
        } catch {
          await interaction.editReply({
            content: `❌ Unsupported file format: ${ext}. Supported formats: PDF, PNG, JPG, JPEG, WEBP, GIF, BMP, TIFF`,
          })
          return
        }
      }

      const outputName = `${fileName}_watermarked_${Date.now()}${ext}`
      const attachmentOutput = new AttachmentBuilder(watermarkedBuffer, { name: outputName })

      const summary: string[] = []
      if (watermarkTexts.length > 0) {
        summary.push(`**Text:** ${watermarkTexts.map((t, i) => `${i + 1}. "${t}"`).join(", ")}`)
      }
      if (logoAttachment) {
        summary.push(`**Logo:** ${logoAttachment.name} (${Math.round(logoOpacity * 100)}% opacity)`)
      }

      await interaction.editReply({
        content: `✅ Watermark applied!\n${summary.join("\n")}`,
        files: [attachmentOutput],
      })
    } catch (error) {
      console.error("[Discord Bot] Watermark error:", error)
      await interaction.editReply({
        content: `❌ Error adding watermark: ${error instanceof Error ? error.message : "Unknown error"}`,
      })
    }
  },
}

interface WatermarkOptions {
  texts: string[]
  logoBuffer: Buffer | null
  position: "diagonal" | "center" | "bottom-right" | "top-left"
  colorOption: string
  textOpacity: number
  logoOpacity: number
}

function getColorFromOption(colorOption: string): { rgb: [number, number, number]; hex: string } {
  const colors: Record<string, { rgb: [number, number, number]; hex: string }> = {
    "neon-orange": { rgb: [1.0, 0.5, 0.0], hex: "#FF8000" },
    "red": { rgb: [1.0, 0.0, 0.0], hex: "#FF0000" },
    "orange": { rgb: [1.0, 0.65, 0.0], hex: "#FFA500" },
    "yellow": { rgb: [1.0, 1.0, 0.0], hex: "#FFFF00" },
    "lime": { rgb: [0.5, 1.0, 0.0], hex: "#80FF00" },
    "green": { rgb: [0.0, 0.8, 0.0], hex: "#00CC00" },
    "cyan": { rgb: [0.0, 1.0, 1.0], hex: "#00FFFF" },
    "blue": { rgb: [0.0, 0.5, 1.0], hex: "#0080FF" },
    "navy": { rgb: [0.0, 0.0, 0.5], hex: "#000080" },
    "purple": { rgb: [0.5, 0.0, 0.5], hex: "#800080" },
    "magenta": { rgb: [1.0, 0.0, 1.0], hex: "#FF00FF" },
    "pink": { rgb: [1.0, 0.75, 0.8], hex: "#FFBFFF" },
    "hot-pink": { rgb: [1.0, 0.41, 0.71], hex: "#FF69B4" },
    "gold": { rgb: [1.0, 0.84, 0.0], hex: "#FFD700" },
    "silver": { rgb: [0.75, 0.75, 0.75], hex: "#C0C0C0" },
    "teal": { rgb: [0.0, 0.5, 0.5], hex: "#008080" },
    "turquoise": { rgb: [0.25, 0.88, 0.82], hex: "#40E0D0" },
    "coral": { rgb: [1.0, 0.5, 0.31], hex: "#FF7F50" },
    "crimson": { rgb: [0.86, 0.08, 0.24], hex: "#DC143C" },
    "violet": { rgb: [0.93, 0.51, 0.93], hex: "#EE82EE" },
    "indigo": { rgb: [0.29, 0.0, 0.51], hex: "#4B0082" },
    "maroon": { rgb: [0.5, 0.0, 0.0], hex: "#800000" },
    "olive": { rgb: [0.5, 0.5, 0.0], hex: "#808000" },
    "gray": { rgb: [0.5, 0.5, 0.5], hex: "#808080" },
    "black": { rgb: [0.0, 0.0, 0.0], hex: "#000000" },
  }
  return colors[colorOption] || colors["neon-orange"]
}

// ==================== PDF WATERMARK ====================

async function addWatermarkToPDF(buffer: Buffer, opts: WatermarkOptions): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(buffer)
  const helveticaBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const pages = pdfDoc.getPages()
  const color = getColorFromOption(opts.colorOption)
  const watermarkColor = rgb(color.rgb[0], color.rgb[1], color.rgb[2])

  let embeddedLogo: Awaited<ReturnType<typeof pdfDoc.embedPng>> | null = null
  let logoNativeWidth = 0
  let logoNativeHeight = 0

  if (opts.logoBuffer) {
    try {
      embeddedLogo = await pdfDoc.embedPng(opts.logoBuffer)
    } catch {
      embeddedLogo = await pdfDoc.embedJpg(opts.logoBuffer)
    }
    logoNativeWidth = embeddedLogo.width
    logoNativeHeight = embeddedLogo.height
  }

  for (const page of pages) {
    const { width, height } = page.getSize()
    const fontSize = Math.min(width, height) * 0.05

    // --- Logo: always centered, sized to fill the page ---
    if (embeddedLogo) {
      const aspect = logoNativeWidth / logoNativeHeight
      // Scale so the logo spans the larger page dimension (covers the full page)
      const logoDim = Math.max(width, height)
      let logoW: number, logoH: number
      if (aspect >= 1) {
        logoW = logoDim
        logoH = logoDim / aspect
      } else {
        logoH = logoDim
        logoW = logoDim * aspect
      }

      page.drawImage(embeddedLogo, {
        x: width / 2 - logoW / 2,
        y: height / 2 - logoH / 2,
        width: logoW,
        height: logoH,
        opacity: opts.logoOpacity,
      })
    }

    // --- Text watermarks ---
    if (opts.texts.length > 0) {
      if (opts.position === "diagonal") {
        const diagonalLength = Math.sqrt(width * width + height * height)
        const spacing = diagonalLength / Math.sqrt(25)
        let textIndex = 0
        for (let y = -height * 0.5; y < height * 1.5; y += spacing * 0.6) {
          for (let x = -width * 0.5; x < width * 1.5; x += spacing * 0.8) {
            const currentText = opts.texts[textIndex % opts.texts.length]
            page.drawText(currentText, {
              x: x + spacing * 0.4,
              y: y + spacing * 0.3,
              size: fontSize,
              font: helveticaBoldFont,
              opacity: opts.textOpacity,
              color: watermarkColor,
              rotate: degrees(-45),
            })
            textIndex++
          }
        }
      } else if (opts.position === "center") {
        const totalHeight = opts.texts.length * fontSize * 1.5
        let currentY = height / 2 + totalHeight / 2
        for (const text of opts.texts) {
          const textWidth = helveticaBoldFont.widthOfTextAtSize(text, fontSize)
          page.drawText(text, {
            x: width / 2 - textWidth / 2,
            y: currentY,
            size: fontSize,
            font: helveticaBoldFont,
            opacity: opts.textOpacity,
            color: watermarkColor,
            rotate: degrees(-45),
          })
          currentY -= fontSize * 1.5
        }
      } else if (opts.position === "bottom-right") {
        let currentY = fontSize * 1.5
        for (const text of opts.texts) {
          const textWidth = helveticaBoldFont.widthOfTextAtSize(text, fontSize)
          page.drawText(text, {
            x: width - textWidth - fontSize,
            y: currentY,
            size: fontSize,
            font: helveticaBoldFont,
            opacity: opts.textOpacity,
            color: watermarkColor,
          })
          currentY += fontSize * 1.5
        }
      } else if (opts.position === "top-left") {
        let currentY = height - fontSize * 1.5
        for (const text of opts.texts) {
          page.drawText(text, {
            x: fontSize * 0.5,
            y: currentY,
            size: fontSize,
            font: helveticaBoldFont,
            opacity: opts.textOpacity,
            color: watermarkColor,
          })
          currentY -= fontSize * 1.5
        }
      }
    }
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}

// ==================== IMAGE WATERMARK ====================

async function addWatermarkToImage(buffer: Buffer, opts: WatermarkOptions): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width || 800
  const height = metadata.height || 600
  const fontSize = Math.min(width, height) * 0.05
  const color = getColorFromOption(opts.colorOption)
  const watermarkColorHex = color.hex

  const svgParts: string[] = []

  // --- Logo: embed as base64 image in the SVG with opacity ---
  if (opts.logoBuffer) {
    const logoMeta = await sharp(opts.logoBuffer).metadata()
    const logoNW = logoMeta.width || 100
    const logoNH = logoMeta.height || 100
    const aspect = logoNW / logoNH

    const fitDim = Math.max(width, height)
    let logoW: number, logoH: number
    if (aspect >= 1) {
      logoW = fitDim
      logoH = fitDim / aspect
    } else {
      logoH = fitDim
      logoW = fitDim * aspect
    }

    const logoX = Math.round(width / 2 - logoW / 2)
    const logoY = Math.round(height / 2 - logoH / 2)
    const base64 = opts.logoBuffer.toString("base64")

    svgParts.push(
      `<image href="data:image/png;base64,${base64}" x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}" opacity="${opts.logoOpacity}" />`
    )
  }

  // --- Text elements ---
  if (opts.texts.length > 0) {
    if (opts.position === "diagonal") {
      const diagonalLength = Math.sqrt(width * width + height * height)
      const spacing = diagonalLength / Math.sqrt(25)
      let textIndex = 0
      for (let y = -height * 0.5; y < height * 1.5; y += spacing * 0.6) {
        for (let x = -width * 0.5; x < width * 1.5; x += spacing * 0.8) {
          const xPos = x + spacing * 0.4
          const yPos = y + spacing * 0.3
          const currentText = opts.texts[textIndex % opts.texts.length]
          svgParts.push(
            `<text x="${xPos}" y="${yPos}" font-size="${fontSize}" font-weight="bold" fill="${watermarkColorHex}" opacity="${opts.textOpacity}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" transform="rotate(-45 ${xPos} ${yPos})">${escapeXml(currentText)}</text>`
          )
          textIndex++
        }
      }
    } else if (opts.position === "center") {
      const totalHeight = opts.texts.length * fontSize * 1.5
      let currentY = height / 2 + totalHeight / 2
      for (const text of opts.texts) {
        svgParts.push(
          `<text x="${width / 2}" y="${currentY}" font-size="${fontSize}" font-weight="bold" fill="${watermarkColorHex}" opacity="${opts.textOpacity}" font-family="Arial, Helvetica, sans-serif" text-anchor="middle" transform="rotate(-45 ${width / 2} ${currentY})">${escapeXml(text)}</text>`
        )
        currentY -= fontSize * 1.5
      }
    } else if (opts.position === "bottom-right") {
      let currentY = fontSize * 1.5
      for (const text of opts.texts) {
        const textWidth = fontSize * text.length * 0.6
        svgParts.push(
          `<text x="${width - textWidth}" y="${currentY}" font-size="${fontSize}" font-weight="bold" fill="${watermarkColorHex}" opacity="${opts.textOpacity}" font-family="Arial, Helvetica, sans-serif" text-anchor="start">${escapeXml(text)}</text>`
        )
        currentY += fontSize * 1.5
      }
    } else if (opts.position === "top-left") {
      let currentY = height - fontSize * 0.5
      for (const text of opts.texts) {
        svgParts.push(
          `<text x="${fontSize * 0.5}" y="${currentY}" font-size="${fontSize}" font-weight="bold" fill="${watermarkColorHex}" opacity="${opts.textOpacity}" font-family="Arial, Helvetica, sans-serif" text-anchor="start">${escapeXml(text)}</text>`
        )
        currentY -= fontSize * 1.5
      }
    }
  }

  const overlaySvg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${svgParts.join("")}</svg>`

  return sharp(buffer)
    .composite([{ input: Buffer.from(overlaySvg), blend: "over" }])
    .toBuffer()
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
