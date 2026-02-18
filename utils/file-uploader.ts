import FormData from "form-data"
import axios from "axios"

export async function uploadFile(fileBuffer: Buffer, filename: string): Promise<string> {
  const uploaders = [
    { name: "tmpfiles.org", fn: uploadToTmpFiles },
    { name: "catbox.moe", fn: uploadToCatbox },
    { name: "0x0.st", fn: uploadTo0x0 },
    { name: "file.io", fn: uploadToFileIO },
  ]

  for (const uploader of uploaders) {
    try {
      console.log(`[v0] Trying ${uploader.name}...`)
      const url = await uploader.fn(fileBuffer, filename)
      console.log(`[v0] Successfully uploaded to ${uploader.name}: ${url}`)
      return url
    } catch (error) {
      console.error(`[v0] ${uploader.name} failed:`, error instanceof Error ? error.message : "Unknown error")
    }
  }

  throw new Error("All file upload services failed")
}

async function uploadToTmpFiles(fileBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append("file", fileBuffer, filename)

  const response = await axios.post("https://tmpfiles.org/api/v1/upload", formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  })

  if (response.data.status === "success") {
    return response.data.data.url.replace("/tmpfiles.org/", "/tmpfiles.org/dl/")
  }
  throw new Error("tmpfiles.org upload failed")
}

async function uploadToCatbox(fileBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append("reqtype", "fileupload")
  formData.append("fileToUpload", fileBuffer, filename)

  const response = await axios.post("https://catbox.moe/user/api.php", formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  })

  return response.data
}

async function uploadTo0x0(fileBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append("file", fileBuffer, filename)

  const response = await axios.post("https://0x0.st", formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  })

  return response.data.trim()
}

async function uploadToFileIO(fileBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append("file", fileBuffer, filename)

  const response = await axios.post("https://file.io", formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    timeout: 120000,
  })

  if (response.data.success) {
    return response.data.link
  }
  throw new Error("file.io upload failed")
}
