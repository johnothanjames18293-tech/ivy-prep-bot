import { QuestionParser } from "../lib/question-parser.js"

export async function generatePDFBuffer(testData: any, watermarkMode: "ekonflux" | "himan"): Promise<Buffer> {
  console.log("[Discord Bot] Starting PDF generation...")

  // Parse test data
  const parsedData = QuestionParser.parseTestData(testData)

  // Call the web app API to generate PDF (solving is done via API)
  const apiUrl = process.env.WEB_APP_URL || "http://localhost:3000"
  const response = await fetch(`${apiUrl}/api/generate-pdf`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      testData: { test: { sections: parsedData.sections }, scoring: testData.scoring },
      watermarkMode,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(`PDF generation failed: ${error.error || response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  return Buffer.from(arrayBuffer)
}
