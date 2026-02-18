import FormData from "form-data"
import fetch from "node-fetch"

export async function uploadToCatbox(fileBuffer: Buffer, fileName: string): Promise<string> {
  const formData = new FormData()
  formData.append("reqtype", "fileupload")
  // Properly specify the buffer as a file with correct content type
  formData.append("fileToUpload", fileBuffer, {
    filename: fileName,
    contentType: "application/pdf",
  })

  console.log("[v0] Uploading to Catbox, buffer size:", fileBuffer.length, "bytes")

  const response = await fetch("https://catbox.moe/user/api.php", {
    method: "POST",
    body: formData,
    headers: formData.getHeaders(),
  })

  if (!response.ok) {
    throw new Error(`Catbox upload failed: ${response.statusText}`)
  }

  const url = await response.text()
  const cleanUrl = url.trim()
  
  console.log("[v0] Catbox upload successful:", cleanUrl)
  
  return cleanUrl
}
