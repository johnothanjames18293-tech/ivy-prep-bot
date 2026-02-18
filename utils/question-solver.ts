import { QuestionParser } from "../lib/question-parser.js"

export async function solveQuestions(
  testData: any,
  solverMode: string = "default",
  paraphrase: boolean = false
): Promise<any> {
  console.log(`[Discord Bot] ===== SOLVE QUESTIONS CALLED =====`)
  console.log(`[Discord Bot] solverMode: ${solverMode}`)
  console.log(`[Discord Bot] paraphrase: ${paraphrase}`)

  const parsedData = QuestionParser.parseTestData(testData)
  const questionsToSolve = QuestionParser.getQuestionsToSolve(parsedData)

  console.log(`[Discord Bot] Found ${questionsToSolve.length} questions to solve`)

  let solvedData: any
  if (questionsToSolve.length > 0 || paraphrase) {
    console.log(`[Discord Bot] Calling web app API...`)
    solvedData = await solveQuestionsViaAPI(testData, solverMode, paraphrase)
    console.log(`[Discord Bot] API call complete`)
  } else {
    solvedData = testData
  }

  return solvedData
}

async function solveQuestionsViaAPI(
  testData: any,
  solverMode: string,
  paraphrase: boolean
): Promise<any> {
  const webAppUrl = process.env.WEB_APP_URL || "http://localhost:3000"

  const controller = new AbortController()
  const timeout = 1800000
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    // Build request body with all parameters
    const requestBody = { 
      testData, 
      solverMode, 
      paraphrase 
    }
    
    console.log(`[Discord Bot] ===== SENDING TO API =====`)
    console.log(`[Discord Bot] URL: ${webAppUrl}/api/solve-and-return`)
    console.log(`[Discord Bot] Body keys: ${Object.keys(requestBody).join(', ')}`)
    console.log(`[Discord Bot] paraphrase value: ${requestBody.paraphrase}`)
    console.log(`[Discord Bot] =============================`)
    
    const response = await fetch(`${webAppUrl}/api/solve-and-return`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`Question solving failed: ${response.statusText}`)
    }

    const result = await response.json()
    return result.solvedTestData
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (error.name === "AbortError") {
      throw new Error(`Question solving timed out after ${timeout / 1000} seconds`)
    }

    throw error
  }
}

export async function solveTestData(
  testData: any,
  solverMode: string = "default",
  paraphrase: boolean = false
): Promise<any> {
  return solveQuestions(testData, solverMode, paraphrase)
}
