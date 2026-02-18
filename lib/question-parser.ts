export class QuestionParser {
  static parseTestData(jsonData: any): any {
    if (!jsonData.test || !jsonData.test.sections) {
      throw new Error("Invalid JSON structure: missing test.sections")
    }

    const sections = jsonData.test.sections
    const scoringData = jsonData.scoring || null

    const answerKeysMap = new Map<string, string[]>()

    if (scoringData && scoringData.sections) {
      Object.values(scoringData.sections).forEach((section: any) => {
        if (section.questions) {
          Object.entries(section.questions).forEach(([questionId, questionScoring]: [string, any]) => {
            answerKeysMap.set(questionId, questionScoring.keys)
          })
        }
      })
    }

    let totalQuestions = 0
    let questionsWithAnswers = 0
    let module1Questions = 0
    let module2Questions = 0

    for (const section of sections) {
      if (!section.chunks || !Array.isArray(section.chunks)) {
        continue
      }

      for (const chunk of section.chunks) {
        if (!chunk.items || !Array.isArray(chunk.items)) {
          continue
        }

        const sectionTitle = (section.title || section.name || "").toLowerCase()
        const chunkName = (chunk.name || "").toLowerCase()
        
        const isModule2 =
          chunkName.includes("module 2") ||
          chunkName.includes("module2") ||
          sectionTitle.includes("module 2") ||
          sectionTitle.includes("module2")

        for (const item of chunk.items) {
          totalQuestions++

          if (item.type === "mcq" && item.answerOptions) {
            item.answerOptions.forEach((option: any, index: number) => {
              option.label = String.fromCharCode(65 + index)
            })
          }

          if (isModule2) {
            item.hasPreProvidedAnswer = false
            module2Questions++
            continue
          }

          module1Questions++

          let hasPreProvidedAnswer = false

          const correctKeys = answerKeysMap.get(item.id)

          if (correctKeys && correctKeys.length > 0) {
            hasPreProvidedAnswer = true
            questionsWithAnswers++

            if (item.type === "mcq" && item.answerOptions) {
              item.answerOptions.forEach((option: any) => {
                if (correctKeys.includes(option.id)) {
                  option.correct = true
                }
              })
            } else if (item.type === "spr") {
              item.correctResponse = correctKeys.join(", ")
            }
          }

          item.hasPreProvidedAnswer = hasPreProvidedAnswer
        }
      }
    }

    console.log("[Discord Bot] Total questions:", totalQuestions)
    console.log("[Discord Bot] Module 1 questions:", module1Questions)
    console.log("[Discord Bot] Module 2 questions:", module2Questions)

    return {
      sections,
      totalQuestions,
      questionsWithAnswers,
      questionsToSolve: module2Questions,
    }
  }

  static getQuestionsToSolve(testData: any): any[] {
    const questionsToSolve: any[] = []

    for (const section of testData.sections) {
      if (!section.chunks || !Array.isArray(section.chunks)) {
        continue
      }

      for (const chunk of section.chunks) {
        if (!chunk.items || !Array.isArray(chunk.items)) {
          continue
        }

        const sectionTitle = (section.title || section.name || "").toLowerCase()
        const chunkName = (chunk.name || "").toLowerCase()
        
        const isModule2 =
          chunkName.includes("module 2") ||
          chunkName.includes("module2") ||
          sectionTitle.includes("module 2") ||
          sectionTitle.includes("module2")

        for (const item of chunk.items) {
          if (item.hasPreProvidedAnswer) {
            continue
          }

          if (isModule2) {
            questionsToSolve.push({
              id: item.id,
              type: item.type,
              stem: item.stem,
              stimulus: item.stimulus,
              answerOptions: item.answerOptions,
              asset: item.asset,
              section: section.name || section.title,
              module: chunk.name,
              stem_uuid: item.id,
            })
          }
        }
      }
    }

    return questionsToSolve
  }
}
