import FormData from "form-data"
import axios from "axios"

export async function uploadToCatbox(fileBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append("reqtype", "fileupload")
  formData.append("fileToUpload", fileBuffer, filename)

  const response = await axios.post("https://catbox.moe/user/api.php", formData, {
    headers: formData.getHeaders(),
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
  })

  return response.data
}
