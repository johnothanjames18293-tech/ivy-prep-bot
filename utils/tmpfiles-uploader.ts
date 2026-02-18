import axios from "axios"
import FormData from "form-data"
import fs from "fs"

export async function uploadToTmpFiles(filePath: string): Promise<string> {
  try {
    const fileBuffer = fs.readFileSync(filePath)
    const form = new FormData()
    form.append("file", fileBuffer, {
      filename: "sat-test.pdf",
      contentType: "application/pdf",
    })

    const response = await axios.post("https://tmpfiles.org/api/v1/upload", form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    })

    if (response.data && response.data.data && response.data.data.url) {
      const url = response.data.data.url
      const directUrl = url.replace("tmpfiles.org/", "tmpfiles.org/dl/")
      console.log("[v0] PDF uploaded to tmpfiles:", directUrl)
      return directUrl
    }

    throw new Error("Invalid response from tmpfiles")
  } catch (error: any) {
    console.error("[v0] Error uploading to tmpfiles:", error.message)
    throw error
  }
}
