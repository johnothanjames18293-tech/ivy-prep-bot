import { SlashCommandBuilder, ChatInputCommandInteraction, AttachmentBuilder } from "discord.js"
import { PDFDocument, rgb } from "pdf-lib"
import sharp from "sharp"
import fetch from "node-fetch"
import path from "path"
import FormData from "form-data"
import Replicate from "replicate"
import fs from "fs"
import os from "os"
import { pdfToPng } from "pdf-to-png-converter"
import { exec } from "child_process"
import { promisify } from "util"

const execAsync = promisify(exec)

export const watermarkremoverCommand = {
  data: new SlashCommandBuilder()
    .setName("watermarkremover")
    .setDescription("Remove any branding, watermarks, text, logos, or symbols from files")
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription("The file to remove branding from (supports PDF, PNG, JPG, JPEG, WEBP, MP4, etc.)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("color")
        .setDescription("What color is the watermark?")
        .setRequired(false)
        .addChoices(
          { name: "Gray (most common)", value: "gray" },
          { name: "Red/Pink", value: "red" },
          { name: "Blue/Cyan", value: "blue" },
          { name: "Green", value: "green" },
          { name: "Yellow/Orange", value: "yellow" },
          { name: "All colors (for documents - keeps only black text)", value: "all" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("intensity")
        .setDescription("How aggressive the removal should be")
        .setRequired(false)
        .addChoices(
          { name: "Light (preserves more detail)", value: "light" },
          { name: "Medium (recommended)", value: "medium" },
          { name: "Aggressive (removes more)", value: "aggressive" }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Defer if not already deferred by bot.ts
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply()
      }
      
      const attachment = interaction.options.getAttachment("file")!
      const intensity = (interaction.options.getString("intensity") || "medium") as "light" | "medium" | "aggressive"
      const watermarkColor = (interaction.options.getString("color") || "gray") as "gray" | "red" | "blue" | "green" | "yellow" | "all"

      console.log(`[Watermark Remover] Starting - file: ${attachment.name}, intensity: ${intensity}, color: ${watermarkColor}`)

      if (!attachment.url) {
        await interaction.editReply("❌ Invalid file")
        return
      }

      await interaction.editReply({
        content: `🔄 Processing ${attachment.name}... This may take a minute.`,
      })

      const response = await fetch(attachment.url)
      let buffer: Buffer
      if (response.arrayBuffer) {
        const arrayBuffer = await response.arrayBuffer()
        buffer = Buffer.from(arrayBuffer)
      } else {
        buffer = await (response as any).buffer()
      }

      const ext = path.extname(attachment.name).toLowerCase()
      const fileName = path.basename(attachment.name, ext)

      // Check file size (LightPDF API typically has a 10-20MB limit)
      const fileSizeMB = buffer.length / (1024 * 1024)
      console.log(`[Watermark Remover] Processing file: ${attachment.name}, extension: ${ext}, size: ${fileSizeMB.toFixed(2)}MB`)

      let cleanedBuffer: Buffer
      
      if (ext === ".pdf") {
        // Process PDF by converting pages to images
        console.log("[Watermark Remover] Processing PDF...")
        try {
          await interaction.editReply({
            content: `🔄 Converting PDF pages to images and processing... This may take a while for large PDFs.`,
          })
          cleanedBuffer = await removeWatermarkFromPDF(buffer, intensity, watermarkColor)
          console.log("[Watermark Remover] PDF processed successfully!")
        } catch (pdfError: any) {
          console.error("[Watermark Remover] PDF processing failed:", pdfError.message)
          await interaction.editReply({
            content: `❌ Error processing PDF: ${pdfError.message}\n\nTip: Try converting your PDF to PNG images first using pdf2png.com`,
          })
          return
        }
      } else if ([".mp4", ".mov", ".avi", ".webm", ".mkv"].includes(ext)) {
        // Process video
        console.log("[Watermark Remover] Processing video...")
        try {
          await interaction.editReply({
            content: `🔄 Processing video... This may take several minutes depending on video length.`,
          })
          cleanedBuffer = await removeWatermarkFromVideo(buffer, intensity, watermarkColor, ext, async (progress: string) => {
            try {
              await interaction.editReply({ content: `🔄 ${progress}` })
            } catch (e) {
              // Ignore edit errors during progress updates
            }
          })
          console.log("[Watermark Remover] Video processed successfully!")
        } catch (videoError: any) {
          console.error("[Watermark Remover] Video processing failed:", videoError.message)
          await interaction.editReply({
            content: `❌ Error processing video: ${videoError.message}\n\nNote: Video processing requires ffmpeg to be installed.`,
          })
          return
        }
      } else if ([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif"].includes(ext)) {
        // For images, try to compress if too large
        if (fileSizeMB > 20) {
          console.log("[Watermark Remover] Image is too large, attempting compression...")
          try {
            await interaction.editReply({
              content: `🔄 Image is large (${fileSizeMB.toFixed(2)}MB). Compressing and processing...`,
            })
            // Compress image first
            const compressed = await sharp(buffer)
              .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer()
            
            const compressedSizeMB = compressed.length / (1024 * 1024)
            console.log(`[Watermark Remover] Compressed to ${compressedSizeMB.toFixed(2)}MB`)
            
            if (compressedSizeMB > 20) {
              throw new Error(`Image too large even after compression (${compressedSizeMB.toFixed(2)}MB). Please compress manually.`)
            }
            
            cleanedBuffer = await removeWatermarkUsingAPI(compressed, intensity, "image")
            console.log("[Watermark Remover] Large image processed successfully!")
          } catch (compressError: any) {
            console.error("[Watermark Remover] Failed to process large image:", compressError.message)
            await interaction.editReply({
              content: `❌ ${compressError.message}\n\nNote: Image watermark removal via API requires files under 20MB. Please compress your image first.`,
            })
            return
          }
        } else {
          // Try LightPDF API for smaller images
          console.log("[Watermark Remover] Detected image, trying API first...")
          try {
            cleanedBuffer = await removeWatermarkUsingAPI(buffer, intensity, "image")
            console.log("[Watermark Remover] API succeeded for image!")
          } catch (apiError: any) {
            console.error("[Watermark Remover] API failed for image:", apiError.message)
            console.log("[Watermark Remover] Falling back to local processing...")
            cleanedBuffer = await removeWatermarkFromImage(buffer, intensity, watermarkColor)
          }
        }
      } else {
        console.log("[Watermark Remover] Unknown extension, trying as image...")
        try {
          cleanedBuffer = await removeWatermarkUsingAPI(buffer, intensity, "image")
          console.log("[Watermark Remover] API succeeded!")
        } catch (apiError: any) {
          console.error("[Watermark Remover] API failed:", apiError.message)
          try {
            cleanedBuffer = await removeWatermarkFromImage(buffer, intensity, watermarkColor)
          } catch (error) {
            await interaction.editReply({
              content: `❌ Unsupported file format: ${ext}. Supported formats: PDF, PNG, JPG, JPEG, WEBP, GIF, BMP, TIFF, MP4, MOV, AVI, WEBM, MKV`,
            })
            return
          }
        }
      }

      // Determine output extension
      let outputExt = ".png"
      if (ext === ".pdf") outputExt = ".pdf"
      else if ([".mp4", ".mov", ".avi", ".webm", ".mkv"].includes(ext)) outputExt = ".mp4"
      
      const outputName = `${fileName}_cleaned_${Date.now()}${outputExt}`
      const attachmentOutput = new AttachmentBuilder(cleanedBuffer, { name: outputName })

      try {
        await interaction.editReply({
          content: `✅ Branding and watermarks removed!\n\nNote: Results vary based on image complexity. Use "Aggressive" mode for stubborn watermarks.`,
          files: [attachmentOutput],
        })
      } catch (err: any) {
        if (err.code === 10062 || err.message?.includes("Unknown interaction")) {
          console.log("[Discord Bot] Interaction expired before sending result")
          return
        }
        throw err
      }
    } catch (error: any) {
      console.error("[Discord Bot] Remove watermark error:", error)
      
      if (error.code === 10062 || error.message?.includes("Unknown interaction")) {
        console.log("[Discord Bot] Interaction expired, cannot send error message")
        return
      }
      
      try {
        await interaction.editReply({
          content: `❌ Error removing watermark: ${error instanceof Error ? error.message : "Unknown error"}`,
        })
      } catch (err: any) {
        if (err.code !== 10062) {
          console.error("[Discord Bot] Failed to send error message:", err)
        }
      }
    }
  },
}

async function removeWatermarkUsingAPI(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive",
  fileType: "pdf" | "image"
): Promise<Buffer> {
  // Try multiple APIs in order of preference
  const watermarkRemoverApiKey = process.env.WATERMARKREMOVER_API_KEY
  const lightpdfApiKey = process.env.LIGHTPDF_API_KEY
  
  // Try WatermarkRemover.io first (more reliable)
  if (watermarkRemoverApiKey) {
    try {
      console.log("[Watermark Remover] Trying WatermarkRemover.io API...")
      return await removeWatermarkWatermarkRemover(buffer, watermarkRemoverApiKey, intensity, fileType)
    } catch (error: any) {
      console.log("[Watermark Remover] WatermarkRemover.io failed:", error.message)
      // Fall through to LightPDF
    }
  }
  
  // Try LightPDF as backup
  if (lightpdfApiKey) {
    try {
      console.log("[Watermark Remover] Trying LightPDF API...")
      return await removeWatermarkLightPDF(buffer, lightpdfApiKey, intensity, fileType)
    } catch (error: any) {
      console.log("[Watermark Remover] LightPDF failed:", error.message)
      throw error
    }
  }
  
  // No API keys - use local processing
  console.log("[Watermark Remover] No API keys found, using local processing...")
  throw new Error("Using local processing (no API configured)")
}

async function removeWatermarkLightPDF(
  buffer: Buffer,
  apiKey: string,
  intensity: "light" | "medium" | "aggressive",
  fileType: "pdf" | "image"
): Promise<Buffer> {
  // LightPDF AI Watermark Removal API
  // Documentation: 
  // - Images: https://lightpdf.com/image-watermark-remover-api-doc
  // - PDFs: https://lightpdf.com/remove-watermark-api-doc
  
  console.log(`[Watermark Remover] Starting LightPDF API call for ${fileType}`)
  console.log(`[Watermark Remover] Buffer size: ${buffer.length} bytes`)
  
  // LightPDF typically uses form-data for file uploads
  const endpoint = fileType === "pdf" 
    ? "https://api.lightpdf.com/v1/remove-watermark" 
    : "https://api.lightpdf.com/v1/image-watermark-remover"
  
  console.log(`[Watermark Remover] Using endpoint: ${endpoint}`)
  
  // Use FormData for file upload
  const formData = new FormData()
  formData.append("api_key", apiKey)
  formData.append("file", buffer, {
    filename: fileType === "pdf" ? "document.pdf" : "image.jpg",
    contentType: fileType === "pdf" ? "application/pdf" : "image/jpeg",
  })
  
  // Add intensity parameter if supported
  if (intensity !== "medium") {
    formData.append("intensity", intensity)
  }
  
  console.log(`[Watermark Remover] Sending request to LightPDF API...`)
  
  const response = await fetch(endpoint, {
    method: "POST",
    body: formData as any,
  })
  
  console.log(`[Watermark Remover] Response status: ${response.status}`)
  console.log(`[Watermark Remover] Response ok: ${response.ok}`)
  
  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`
    
    if (response.status === 413) {
      errorMessage = `File too large (${(buffer.length / (1024 * 1024)).toFixed(2)}MB). LightPDF API supports files up to 20MB.`
    } else {
      try {
        const errorText = await response.text()
        errorMessage = `${response.status}: ${errorText.substring(0, 200)}`
        console.error(`[Watermark Remover] API Error: ${errorMessage}`)
      } catch (e) {
        errorMessage = `HTTP ${response.status} - ${response.statusText}`
      }
    }
    
    throw new Error(`LightPDF API error: ${errorMessage}`)
  }
  
  const responseText = await response.text()
  console.log(`[Watermark Remover] Response body (first 500 chars): ${responseText.substring(0, 500)}`)
  
  let result: any
  try {
    result = JSON.parse(responseText)
  } catch (e) {
    console.error(`[Watermark Remover] Failed to parse JSON response:`, e)
    throw new Error(`LightPDF API returned invalid JSON: ${responseText.substring(0, 200)}`)
  }
  
  console.log(`[Watermark Remover] Parsed result keys:`, Object.keys(result))
  console.log(`[Watermark Remover] Parsed result (first 1000 chars):`, JSON.stringify(result, null, 2).substring(0, 1000))
  
  // Check for errors
  if (result.status !== 200 && result.code !== 200) {
    if (!result.success) {
      console.error(`[Watermark Remover] API returned error:`, result)
      throw new Error(`LightPDF API error: ${result.message || "Unknown error"}`)
    }
  }
  
  // Try to get the processed image/PDF
  // LightPDF may return the file in different formats
  if (result.data?.file) {
    const fileResponse = await fetch(result.data.file)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.data?.output) {
    const fileResponse = await fetch(result.data.output)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.data?.base64) {
    return Buffer.from(result.data.base64, "base64")
  }
  
  if (result.data?.image) {
    return Buffer.from(result.data.image, "base64")
  }
  
  // Try top-level properties
  if (result.file) {
    const fileResponse = await fetch(result.file)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.output) {
    const fileResponse = await fetch(result.output)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.base64) {
    return Buffer.from(result.base64, "base64")
  }
  
  if (result.image) {
    return Buffer.from(result.image, "base64")
  }
  
  throw new Error("LightPDF API did not return processed file")
}

async function removeWatermarkWatermarkRemover(
  buffer: Buffer,
  apiKey: string,
  intensity: "light" | "medium" | "aggressive",
  fileType: "pdf" | "image"
): Promise<Buffer> {
  // WatermarkRemover.io API - more reliable alternative
  // Documentation: https://www.watermarkremover.io/api
  
  console.log(`[Watermark Remover] Starting WatermarkRemover.io API call for ${fileType}`)
  console.log(`[Watermark Remover] Buffer size: ${buffer.length} bytes`)
  
  // WatermarkRemover.io API endpoint
  // Try different possible endpoint formats
  const endpoints = [
    "https://api.watermarkremover.io/api/v1/remove",
    "https://api.watermarkremover.io/remove",
    "https://www.watermarkremover.io/api/remove"
  ]
  
  let lastError: any = null
  
  for (const endpoint of endpoints) {
    try {
      console.log(`[Watermark Remover] Trying endpoint: ${endpoint}`)
      
      // Use FormData for file upload
      const formData = new FormData()
      formData.append("api_key", apiKey)
      formData.append("file", buffer, {
        filename: fileType === "pdf" ? "document.pdf" : "image.jpg",
        contentType: fileType === "pdf" ? "application/pdf" : "image/jpeg",
      })
      
      // Also try alternative parameter names
      formData.append("apiKey", apiKey)
      
      const response = await fetch(endpoint, {
        method: "POST",
        body: formData as any,
      })
      
      if (response.ok) {
        console.log(`[Watermark Remover] Success with endpoint: ${endpoint}`)
        return await parseWatermarkRemoverResponse(response)
      }
      
      if (response.status !== 404) {
        // If it's not 404, this might be the right endpoint but with wrong params
        lastError = new Error(`HTTP ${response.status}: ${await response.text().catch(() => response.statusText)}`)
        continue
      }
    } catch (error: any) {
      lastError = error
      console.log(`[Watermark Remover] Endpoint ${endpoint} failed:`, error.message)
      continue
    }
  }
  
  throw lastError || new Error("All WatermarkRemover.io endpoints failed")
}

async function parseWatermarkRemoverResponse(response: any): Promise<Buffer> {
  console.log(`[Watermark Remover] Response status: ${response.status}`)
  console.log(`[Watermark Remover] Response ok: ${response.ok}`)
  
  const responseText = await response.text()
  console.log(`[Watermark Remover] Response body (first 500 chars): ${responseText.substring(0, 500)}`)
  
  let result: any
  try {
    result = JSON.parse(responseText)
  } catch (e) {
    // Maybe it's not JSON - could be direct file data
    if (responseText.length > 100 && !responseText.startsWith("<")) {
      // Might be base64 or binary
      try {
        return Buffer.from(responseText, "base64")
      } catch {
        return Buffer.from(responseText)
      }
    }
    console.error(`[Watermark Remover] Failed to parse JSON response:`, e)
    throw new Error(`WatermarkRemover.io API returned invalid JSON: ${responseText.substring(0, 200)}`)
  }
  
  console.log(`[Watermark Remover] Parsed result keys:`, Object.keys(result))
  
  // Check for errors
  if (result.status !== 200 && result.code !== 200) {
    if (!result.success) {
      console.error(`[Watermark Remover] API returned error:`, result)
      throw new Error(`WatermarkRemover.io API error: ${result.message || "Unknown error"}`)
    }
  }
  
  // Try to get the processed file - check various response formats
  if (result.data?.file) {
    const fileResponse = await fetch(result.data.file)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.data?.output_url || result.data?.output) {
    const url = result.data.output_url || result.data.output
    const fileResponse = await fetch(url)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.data?.base64) {
    return Buffer.from(result.data.base64, "base64")
  }
  
  if (result.output_url || result.output) {
    const url = result.output_url || result.output
    const fileResponse = await fetch(url)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  if (result.base64) {
    return Buffer.from(result.base64, "base64")
  }
  
  if (result.url) {
    const fileResponse = await fetch(result.url)
    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer()
      return Buffer.from(arrayBuffer)
    }
  }
  
  throw new Error("WatermarkRemover.io API did not return processed file")
}

async function processLargePDF(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive"
): Promise<Buffer> {
  // Split large PDF into chunks, process each, then combine
  const pdfDoc = await PDFDocument.load(buffer)
  const pages = pdfDoc.getPages()
  const totalPages = pages.length
  
  if (totalPages === 0) {
    throw new Error("PDF has no pages")
  }
  
  console.log(`[Watermark Remover] Processing large PDF with ${totalPages} pages`)
  
  // Calculate pages per chunk (aim for ~10MB chunks to be safer and avoid 502 errors)
  const targetChunkSizeMB = 10
  const estimatedSizePerPage = buffer.length / totalPages
  const pagesPerChunk = Math.floor((targetChunkSizeMB * 1024 * 1024) / estimatedSizePerPage) || 1
  const numChunks = Math.ceil(totalPages / pagesPerChunk)
  
  console.log(`[Watermark Remover] Splitting into ${numChunks} chunks (~${pagesPerChunk} pages each)`)
  
  const processedChunks: PDFDocument[] = []
  
  // Process each chunk
  for (let chunkIndex = 0; chunkIndex < numChunks; chunkIndex++) {
    const startPage = chunkIndex * pagesPerChunk
    const endPage = Math.min(startPage + pagesPerChunk, totalPages)
    
    console.log(`[Watermark Remover] Processing chunk ${chunkIndex + 1}/${numChunks} (pages ${startPage + 1}-${endPage})`)
    
    // Create a new PDF with just this chunk's pages
    const chunkDoc = await PDFDocument.create()
    
    for (let i = startPage; i < endPage; i++) {
      const [copiedPage] = await chunkDoc.copyPages(pdfDoc, [i])
      chunkDoc.addPage(copiedPage)
    }
    
    const chunkBuffer = Buffer.from(await chunkDoc.save())
    const chunkSizeMB = chunkBuffer.length / (1024 * 1024)
    console.log(`[Watermark Remover] Chunk ${chunkIndex + 1} size: ${chunkSizeMB.toFixed(2)}MB`)
    
    // Process this chunk with retry logic
    let processedChunkBuffer: Buffer = chunkBuffer // Default to original if all fails
    let retries = 3
    let lastError: any = null
    
    while (retries > 0) {
      try {
        processedChunkBuffer = await removeWatermarkUsingAPI(chunkBuffer, intensity, "pdf")
        console.log(`[Watermark Remover] Chunk ${chunkIndex + 1} processed successfully`)
        break
      } catch (apiError: any) {
        lastError = apiError
        console.error(`[Watermark Remover] API failed for chunk ${chunkIndex + 1} (${retries} retries left):`, apiError.message)
        
        // If it's a 502 or 503 error (server error), retry
        if ((apiError.message.includes("502") || apiError.message.includes("503") || apiError.message.includes("504")) && retries > 1) {
          retries--
          const waitTime = (4 - retries) * 2 // 2, 4, 6 seconds
          console.log(`[Watermark Remover] Retrying chunk ${chunkIndex + 1} in ${waitTime} seconds...`)
          await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
          continue
        }
        
        // If it's a 413 (too large), try splitting this chunk further
        if (apiError.message.includes("413") || apiError.message.includes("too large")) {
          console.log(`[Watermark Remover] Chunk ${chunkIndex + 1} still too large, splitting further...`)
          // Split this chunk in half
          const chunkDoc = await PDFDocument.load(chunkBuffer)
          const chunkPages = chunkDoc.getPages()
          const midPoint = Math.floor(chunkPages.length / 2)
          
          // Create two smaller chunks
          const subChunk1 = await PDFDocument.create()
          const subChunk2 = await PDFDocument.create()
          
          for (let i = 0; i < midPoint; i++) {
            const [page] = await subChunk1.copyPages(chunkDoc, [i])
            subChunk1.addPage(page)
          }
          for (let i = midPoint; i < chunkPages.length; i++) {
            const [page] = await subChunk2.copyPages(chunkDoc, [i])
            subChunk2.addPage(page)
          }
          
          // Process both sub-chunks
          const subChunk1Buffer = Buffer.from(await subChunk1.save())
          const subChunk2Buffer = Buffer.from(await subChunk2.save())
          
          let processedSub1: Buffer, processedSub2: Buffer
          try {
            processedSub1 = await removeWatermarkUsingAPI(subChunk1Buffer, intensity, "pdf")
          } catch (e) {
            processedSub1 = subChunk1Buffer
          }
          try {
            processedSub2 = await removeWatermarkUsingAPI(subChunk2Buffer, intensity, "pdf")
          } catch (e) {
            processedSub2 = subChunk2Buffer
          }
          
          // Combine sub-chunks
          const combinedSub = await PDFDocument.create()
          const sub1Doc = await PDFDocument.load(processedSub1)
          const sub2Doc = await PDFDocument.load(processedSub2)
          const sub1Pages = sub1Doc.getPages()
          const sub2Pages = sub2Doc.getPages()
          
          const copied1 = await combinedSub.copyPages(sub1Doc, sub1Pages.map((_, i) => i))
          const copied2 = await combinedSub.copyPages(sub2Doc, sub2Pages.map((_, i) => i))
          copied1.forEach(p => combinedSub.addPage(p))
          copied2.forEach(p => combinedSub.addPage(p))
          
          processedChunkBuffer = Buffer.from(await combinedSub.save())
          console.log(`[Watermark Remover] Chunk ${chunkIndex + 1} processed after further splitting`)
          break
        }
        
        // For other errors or final retry failure, use original
        if (retries === 1) {
          console.error(`[Watermark Remover] All retries failed for chunk ${chunkIndex + 1}, using original (no watermark removal)`)
          processedChunkBuffer = chunkBuffer
          break
        }
        
        retries--
        const waitTime = (4 - retries) * 2
        console.log(`[Watermark Remover] Retrying chunk ${chunkIndex + 1} in ${waitTime} seconds...`)
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000))
      }
    }
    
    // processedChunkBuffer is already initialized to chunkBuffer, so it's safe
    
    // Load the processed chunk
    const processedChunkDoc = await PDFDocument.load(processedChunkBuffer)
    processedChunks.push(processedChunkDoc)
  }
  
  // Combine all processed chunks into one PDF
  console.log(`[Watermark Remover] Combining ${processedChunks.length} chunks...`)
  const finalDoc = await PDFDocument.create()
  
  for (const chunkDoc of processedChunks) {
    const chunkPages = chunkDoc.getPages()
    const copiedPages = await finalDoc.copyPages(chunkDoc, chunkPages.map((_, i) => i))
    copiedPages.forEach((page) => finalDoc.addPage(page))
  }
  
  const finalBuffer = Buffer.from(await finalDoc.save())
  console.log(`[Watermark Remover] Combined PDF size: ${(finalBuffer.length / (1024 * 1024)).toFixed(2)}MB`)
  
  return finalBuffer
}

async function removeWatermarkFromPDF(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive",
  watermarkColor: "gray" | "red" | "blue" | "green" | "yellow" | "all" = "gray"
): Promise<Buffer> {
  console.log("[Watermark Remover] Converting PDF pages to images using pdf-to-png-converter...")
  
  // Convert PDF to PNG images (pdfToPng accepts ArrayBuffer in types; Node Buffer works at runtime)
  const pngPages = await pdfToPng(buffer as unknown as ArrayBuffer, {
    disableFontFace: true,
    useSystemFonts: true,
    viewportScale: 2.0, // Higher quality
  })
  
  if (!pngPages || pngPages.length === 0) {
    throw new Error("PDF has no pages or failed to convert")
  }
  
  console.log(`[Watermark Remover] PDF has ${pngPages.length} pages`)
  
  // Create new PDF for output
  const newPdf = await PDFDocument.create()
  
  // Process each page
  for (let i = 0; i < pngPages.length; i++) {
    const pageNum = i + 1
    console.log(`[Watermark Remover] Processing page ${pageNum}/${pngPages.length}...`)
    
    try {
      const pngPage = pngPages[i]
      const imageBuffer = pngPage.content
      
      if (!imageBuffer || imageBuffer.length === 0) {
        console.error(`[Watermark Remover] Page ${pageNum} has no content`)
        continue
      }
      
      console.log(`[Watermark Remover] Page ${pageNum} converted (${imageBuffer.length} bytes)`)
      
      // Process the image to remove watermark
      const processedImage = await removeWatermarkFromImage(Buffer.from(imageBuffer), intensity, watermarkColor)
      
      // Get image dimensions
      const metadata = await sharp(processedImage).metadata()
      const width = metadata.width || 612
      const height = metadata.height || 792
      
      // Add processed image to new PDF (scale to standard page size)
      const pdfImage = await newPdf.embedPng(processedImage)
      const pdfPage = newPdf.addPage([width / 2, height / 2]) // Scale back to normal size
      
      pdfPage.drawImage(pdfImage, {
        x: 0,
        y: 0,
        width: width / 2,
        height: height / 2,
      })
      
      console.log(`[Watermark Remover] Page ${pageNum} done`)
      
    } catch (pageError: any) {
      console.error(`[Watermark Remover] Error on page ${pageNum}:`, pageError.message)
    }
  }
  
  if (newPdf.getPageCount() === 0) {
    throw new Error("Failed to process any pages")
  }
  
  console.log(`[Watermark Remover] PDF complete! ${newPdf.getPageCount()} pages`)
  
  const pdfBytes = await newPdf.save()
  return Buffer.from(pdfBytes)
}

async function removeWatermarkFromVideo(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive",
  watermarkColor: "gray" | "red" | "blue" | "green" | "yellow" | "all",
  ext: string,
  onProgress?: (progress: string) => Promise<void>
): Promise<Buffer> {
  console.log("[Watermark Remover] Starting video watermark removal...")
  
  // Create temp directory for processing
  const tempDir = path.join(os.tmpdir(), `watermark_video_${Date.now()}`)
  const framesDir = path.join(tempDir, "frames")
  const processedDir = path.join(tempDir, "processed")
  const inputPath = path.join(tempDir, `input${ext}`)
  const outputPath = path.join(tempDir, "output.mp4")
  
  try {
    // Create directories
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(framesDir, { recursive: true })
    fs.mkdirSync(processedDir, { recursive: true })
    
    // Write input video
    fs.writeFileSync(inputPath, buffer)
    console.log(`[Watermark Remover] Video saved to ${inputPath}`)
    
    // Get video info
    if (onProgress) await onProgress("Analyzing video...")
    
    let fps = 30
    let duration = 0
    try {
      const { stdout: probeOutput } = await execAsync(
        `ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,duration -of csv=p=0 "${inputPath}"`
      )
      const parts = probeOutput.trim().split(",")
      if (parts[0]) {
        const fpsParts = parts[0].split("/")
        fps = Math.round(parseInt(fpsParts[0]) / (parseInt(fpsParts[1]) || 1))
        if (fps > 60) fps = 30 // Cap at 30 for processing speed
      }
      if (parts[1]) {
        duration = parseFloat(parts[1])
      }
      console.log(`[Watermark Remover] Video FPS: ${fps}, Duration: ${duration}s`)
    } catch (e) {
      console.log("[Watermark Remover] Could not probe video, using defaults")
    }
    
    // Extract audio
    if (onProgress) await onProgress("Extracting audio...")
    const audioPath = path.join(tempDir, "audio.aac")
    try {
      await execAsync(`ffmpeg -y -i "${inputPath}" -vn -acodec aac "${audioPath}" 2>/dev/null`)
      console.log("[Watermark Remover] Audio extracted")
    } catch (e) {
      console.log("[Watermark Remover] No audio track or extraction failed")
    }
    
    // Extract frames (limit to 10fps for processing speed)
    const extractFps = Math.min(fps, 10)
    if (onProgress) await onProgress(`Extracting frames (${extractFps} fps)...`)
    await execAsync(`ffmpeg -y -i "${inputPath}" -vf "fps=${extractFps}" "${framesDir}/frame_%05d.png" 2>/dev/null`)
    
    // Get list of frames
    const frames = fs.readdirSync(framesDir).filter(f => f.endsWith(".png")).sort()
    console.log(`[Watermark Remover] Extracted ${frames.length} frames`)
    
    if (frames.length === 0) {
      throw new Error("No frames extracted from video")
    }
    
    // Process each frame
    for (let i = 0; i < frames.length; i++) {
      const frameName = frames[i]
      const framePath = path.join(framesDir, frameName)
      const outputFramePath = path.join(processedDir, frameName)
      
      if (i % 10 === 0 || i === frames.length - 1) {
        const progress = Math.round((i / frames.length) * 100)
        if (onProgress) await onProgress(`Processing frames... ${progress}% (${i + 1}/${frames.length})`)
      }
      
      try {
        // Read frame
        const frameBuffer = fs.readFileSync(framePath)
        
        // Process frame to remove watermark
        const processedBuffer = await removeWatermarkFromImage(frameBuffer, intensity, watermarkColor)
        
        // Write processed frame
        fs.writeFileSync(outputFramePath, processedBuffer)
      } catch (frameError: any) {
        console.error(`[Watermark Remover] Error processing frame ${frameName}:`, frameError.message)
        // Copy original frame if processing fails
        fs.copyFileSync(framePath, outputFramePath)
      }
    }
    
    console.log("[Watermark Remover] All frames processed")
    
    // Reassemble video
    if (onProgress) await onProgress("Reassembling video...")
    
    // Check if audio exists
    const hasAudio = fs.existsSync(audioPath) && fs.statSync(audioPath).size > 0
    
    if (hasAudio) {
      await execAsync(
        `ffmpeg -y -framerate ${extractFps} -i "${processedDir}/frame_%05d.png" -i "${audioPath}" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${outputPath}" 2>/dev/null`
      )
    } else {
      await execAsync(
        `ffmpeg -y -framerate ${extractFps} -i "${processedDir}/frame_%05d.png" -c:v libx264 -pix_fmt yuv420p "${outputPath}" 2>/dev/null`
      )
    }
    
    console.log("[Watermark Remover] Video reassembled")
    
    // Read output video
    const outputBuffer = fs.readFileSync(outputPath)
    
    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true })
    
    console.log(`[Watermark Remover] Video complete! Output size: ${(outputBuffer.length / (1024 * 1024)).toFixed(2)}MB`)
    
    return outputBuffer
    
  } catch (error: any) {
    // Cleanup on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (e) {}
    
    console.error("[Watermark Remover] Video processing error:", error.message)
    throw new Error(`Video processing failed: ${error.message}. Make sure ffmpeg is installed.`)
  }
}

async function removeWatermarkFromImage(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive",
  watermarkColor: "gray" | "red" | "blue" | "green" | "yellow" | "all" = "gray"
): Promise<Buffer> {
  console.log(`[Watermark Remover] removeWatermarkFromImage called - buffer size: ${buffer.length}, intensity: ${intensity}`)
  
  // Verify we have a valid image buffer
  try {
    const metadata = await sharp(buffer).metadata()
    console.log(`[Watermark Remover] Input image: ${metadata.width}x${metadata.height}, format: ${metadata.format}`)
  } catch (metaError: any) {
    console.error("[Watermark Remover] Invalid image buffer:", metaError.message)
    throw new Error(`Invalid image: ${metaError.message}`)
  }
  
  // Try Replicate AI if API key is available
  const replicateApiKey = process.env.REPLICATE_API_TOKEN
  if (replicateApiKey) {
    try {
      console.log("[Watermark Remover] Trying Replicate AI...")
      const result = await removeWatermarkWithAI(buffer, replicateApiKey, intensity)
      console.log("[Watermark Remover] Replicate succeeded!")
      // Ensure PNG format for pdf-lib compatibility
      return await sharp(result).png().toBuffer()
    } catch (error: any) {
      console.error("[Watermark Remover] Replicate failed:", error.message, error.stack)
    }
  } else {
    console.log("[Watermark Remover] No REPLICATE_API_TOKEN found")
  }
  
  // Use improved local processing
  console.log("[Watermark Remover] Using improved local processing...")
  const localResult = await removeWatermarkImproved(buffer, intensity)
  // Ensure PNG format
  return await sharp(localResult).png().toBuffer()
}

async function removeWatermarkWithAI(
  buffer: Buffer,
  apiKey: string,
  intensity: "light" | "medium" | "aggressive"
): Promise<Buffer> {
  console.log("[Watermark Remover] removeWatermarkWithAI called")
  
  // Use Replicate LAMA model
  const replicate = new Replicate({ auth: apiKey })
  
  console.log("[Watermark Remover] Preparing image for Replicate LAMA...")
  
  // Convert input to PNG first
  const pngBuffer = await sharp(buffer).png().toBuffer()
  
  const metadata = await sharp(pngBuffer).metadata()
  const width = metadata.width!
  const height = metadata.height!
  
  console.log(`[Watermark Remover] Image size: ${width}x${height}`)
  
  // Convert image to base64 data URI
  const imageBase64 = pngBuffer.toString("base64")
  const imageDataUri = `data:image/png;base64,${imageBase64}`
  
  // Create watermark mask
  console.log("[Watermark Remover] Creating watermark mask...")
  
  const { data } = await sharp(pngBuffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  
  const maskData = Buffer.alloc(width * height)
  
  // IMPORTANT: Detect light gray watermark pixels while preserving dark text
  // Watermarks are typically light gray (brightness 140-250)
  // Regular text is DARK (brightness < 120) - DO NOT mask dark pixels!
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3]
    const g = data[i * 3 + 1]
    const b = data[i * 3 + 2]
    const brightness = (r + g + b) / 3
    
    const maxChannel = Math.max(r, g, b)
    const minChannel = Math.min(r, g, b)
    const colorVariation = maxChannel - minChannel
    
    // Target light gray pixels (watermarks), preserve dark text
    const isGray = colorVariation < 35
    const minBrightness = intensity === "aggressive" ? 140 : intensity === "medium" ? 155 : 175
    const maxBrightness = intensity === "aggressive" ? 252 : intensity === "medium" ? 250 : 245
    
    const isLightGrayWatermark = isGray && brightness >= minBrightness && brightness <= maxBrightness
    
    maskData[i] = isLightGrayWatermark ? 255 : 0
  }
  
  // Light dilation only
  const dilatedMask = Buffer.alloc(width * height)
  const dilateRadius = 1
  
  for (let y = dilateRadius; y < height - dilateRadius; y++) {
    for (let x = dilateRadius; x < width - dilateRadius; x++) {
      const idx = y * width + x
      let hasNeighbor = maskData[idx] > 0
      
      if (!hasNeighbor) {
        for (let dy = -dilateRadius; dy <= dilateRadius && !hasNeighbor; dy++) {
          for (let dx = -dilateRadius; dx <= dilateRadius && !hasNeighbor; dx++) {
            if (maskData[(y + dy) * width + (x + dx)] > 0) {
              hasNeighbor = true
            }
          }
        }
      }
      
      dilatedMask[idx] = hasNeighbor ? 255 : 0
    }
  }
  
  // Convert mask to PNG with proper format (white = area to inpaint, black = keep)
  const maskBuffer = await sharp(dilatedMask, {
    raw: { width, height, channels: 1 }
  }).png().toBuffer()
  
  const maskBase64 = maskBuffer.toString("base64")
  const maskDataUri = `data:image/png;base64,${maskBase64}`
  
  console.log("[Watermark Remover] Calling Replicate LAMA model...")
  
  try {
    const output = await replicate.run(
      "andreas128/lama:e3de65a382269c4feaca7d6298df3c328bf60fef3dcf67d98ca08cf3639c5183",
      {
        input: {
          image: imageDataUri,
          mask: maskDataUri,
        }
      }
    )
    
    console.log("[Watermark Remover] Replicate output:", typeof output, output)
    
    // Handle different output formats
    let resultUrl: string
    if (typeof output === "string") {
      resultUrl = output
    } else if (Array.isArray(output) && output.length > 0) {
      resultUrl = output[0]
    } else if (output && typeof output === "object" && "output" in output) {
      resultUrl = (output as any).output
    } else {
      throw new Error(`Unexpected Replicate output format: ${JSON.stringify(output)}`)
    }
    
    console.log("[Watermark Remover] Downloading result from:", resultUrl)
    
    const response = await fetch(resultUrl)
    if (!response.ok) {
      throw new Error(`Failed to download result: ${response.status}`)
    }
    
    const arrayBuffer = await response.arrayBuffer()
    const resultBuffer = Buffer.from(arrayBuffer)
    
    // Ensure result is PNG format for pdf-lib compatibility
    const pngResult = await sharp(resultBuffer).png().toBuffer()
    console.log("[Watermark Remover] AI processing complete! Result size:", pngResult.length)
    return pngResult
    
  } catch (replicateError: any) {
    console.error("[Watermark Remover] Replicate API error:", replicateError)
    throw replicateError
  }
}

async function removeWatermarkHuggingFace(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive"
): Promise<Buffer> {
  // Skip HuggingFace - it doesn't work well for inpainting without proper setup
  // Instead, use improved local processing with better watermark detection
  throw new Error("Skipping HuggingFace - using improved local processing")
}

async function removeWatermarkImproved(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive"
): Promise<Buffer> {
  console.log("[Watermark Remover] Using improved local watermark removal...")
  
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width!
  const height = metadata.height!
  
  // Get raw pixel data
  const { data } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  
  const processedData = Buffer.from(data)
  
  // IMPORTANT: Target light gray watermark pixels while preserving dark text
  // Watermarks are typically light gray (brightness 150-245)
  // Regular text is DARK (brightness < 120) - must preserve!
  
  // Thresholds - target light gray watermarks, preserve dark text
  const config = {
    light: { minBrightness: 180, maxBrightness: 245, colorTolerance: 20 },
    medium: { minBrightness: 160, maxBrightness: 250, colorTolerance: 25 },
    aggressive: { minBrightness: 140, maxBrightness: 252, colorTolerance: 35 }
  }[intensity]
  
  let replaced = 0
  
  // Only replace pixels that are LIGHT gray (watermarks), preserve dark text
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 3]
    const g = data[i * 3 + 1]
    const b = data[i * 3 + 2]
    const brightness = (r + g + b) / 3
    
    // Check if it's grayish (R ≈ G ≈ B)
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const isGray = (maxC - minC) < config.colorTolerance
    
    // ONLY target LIGHT gray pixels (watermarks are light, text is dark)
    const isLightGray = brightness >= config.minBrightness && brightness <= config.maxBrightness
    
    // This is likely a watermark pixel - light gray
    if (isGray && isLightGray) {
      processedData[i * 3] = 255
      processedData[i * 3 + 1] = 255
      processedData[i * 3 + 2] = 255
      replaced++
    }
  }
  
  console.log(`[Watermark Remover] Replaced ${replaced} pixels (${((replaced / (width * height)) * 100).toFixed(1)}%)`)
  
  // Reconstruct image
  const result = sharp(processedData, {
    raw: { width, height, channels: 3 }
  })
  
  return result.png().toBuffer()
}

async function removeWatermarkLocal(
  buffer: Buffer,
  intensity: "light" | "medium" | "aggressive",
  watermarkColor: "gray" | "red" | "blue" | "green" | "yellow" | "all"
): Promise<Buffer> {
  const metadata = await sharp(buffer).metadata()
  const width = metadata.width!
  const height = metadata.height!
  
  console.log(`[Watermark Remover] Local processing: ${width}x${height}, intensity: ${intensity}, color: ${watermarkColor}`)
  
  // Get raw pixel data
  const { data } = await sharp(buffer)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  
  const channels = 3
  const processedData = Buffer.from(data)
  
  let pixelsModified = 0
  
  // IMPORTANT: Target light watermark colors while preserving dark text
  // Dark text (brightness < 120) must be PRESERVED
  const minWatermarkBrightness = intensity === "aggressive" ? 140 : intensity === "medium" ? 155 : 175
  const maxWatermarkBrightness = intensity === "aggressive" ? 252 : intensity === "medium" ? 250 : 245
  const colorTolerance = intensity === "aggressive" ? 40 : intensity === "medium" ? 30 : 25
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * channels
      
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const brightness = (r + g + b) / 3
      
      // Skip dark pixels - these are text, not watermarks!
      if (brightness < minWatermarkBrightness) continue
      if (brightness > maxWatermarkBrightness) continue
      
      let isWatermark = false
      const maxChannel = Math.max(r, g, b)
      const minChannel = Math.min(r, g, b)
      const colorVariation = maxChannel - minChannel
      
      if (watermarkColor === "all" || watermarkColor === "gray") {
        // Only target LIGHT gray pixels
        isWatermark = colorVariation <= colorTolerance
        
      } else if (watermarkColor === "red") {
        const redDominance = r - Math.max(g, b)
        isWatermark = redDominance > 30 && r > 180
        
      } else if (watermarkColor === "blue") {
        const blueDominance = b - Math.max(r, g)
        isWatermark = blueDominance > 30 && b > 180
        
      } else if (watermarkColor === "green") {
        const greenDominance = g - Math.max(r, b)
        isWatermark = greenDominance > 30 && g > 180
        
      } else if (watermarkColor === "yellow") {
        const yellowness = Math.min(r, g) - b
        isWatermark = yellowness > 40 && r > 180 && g > 180
      }
      
      if (isWatermark) {
        processedData[idx] = 255
        processedData[idx + 1] = 255
        processedData[idx + 2] = 255
        pixelsModified++
      }
    }
  }
  
  console.log(`[Watermark Remover] Modified ${pixelsModified} pixels (${((pixelsModified / (width * height)) * 100).toFixed(2)}% of image)`)
  
  let result = sharp(processedData, {
    raw: { width, height, channels: 3 }
  })
  
  if (intensity === "aggressive") {
    result = result.median(3)
  }
  
  console.log("[Watermark Remover] Local processing complete!")
  
  return result.png().toBuffer()
}
