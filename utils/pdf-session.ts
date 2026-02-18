export class PDFSession {
  private pdfs: string[] = []

  add(pdfBase64: string): void {
    this.pdfs.push(pdfBase64)
    console.log(`[Discord Bot] Added PDF to session. Total: ${this.pdfs.length}`)
  }

  getAll(): string[] {
    return this.pdfs
  }

  count(): number {
    return this.pdfs.length
  }

  reset(): void {
    const count = this.pdfs.length
    this.pdfs = []
    console.log(`[Discord Bot] PDF session reset. Cleared ${count} PDF(s)`)
  }

  async merge(): Promise<Buffer> {
    if (this.pdfs.length === 0) {
      throw new Error('No PDFs to merge')
    }

    console.log(`[Discord Bot] Merging ${this.pdfs.length} PDFs...`)

    const webAppUrl = process.env.WEB_APP_URL || 'http://localhost:3000'
    const response = await fetch(`${webAppUrl}/api/merge-pdfs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfs: this.pdfs })
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(`Failed to merge PDFs: ${error.error || response.statusText}`)
    }

    const data = await response.json()
    return Buffer.from(data.pdf, 'base64')
  }
}

export const pdfSession = new PDFSession()
