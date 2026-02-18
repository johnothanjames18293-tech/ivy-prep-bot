import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js"
import { pdfSession } from "../utils/pdf-session.js"

export const resetCommand = {
  data: new SlashCommandBuilder()
    .setName("reset")
    .setDescription("Clear the PDF session and start fresh"),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply()
    }
    const count = pdfSession.count()
    pdfSession.reset()

    await interaction.editReply({
      content: `✅ Session reset! Cleared ${count} PDF(s) from memory.`,
    })
  },
}
