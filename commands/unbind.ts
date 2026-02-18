import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js"

const WEBAPP_URL = process.env.WEBAPP_URL || "https://sat-pdf-generator.vercel.app"

export const unbindCommand = {
  data: new SlashCommandBuilder()
    .setName("unbind")
    .setDescription("Reset device binding for a document (allows access from a new device)")
    .addStringOption((option) =>
      option
        .setName("doc_id")
        .setDescription("The document ID (from the link)")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("access_code")
        .setDescription("The access code for the document")
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    // Defer if not already deferred by bot.ts
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true })
    }

    try {
      const docId = interaction.options.getString("doc_id", true)
      const accessCode = interaction.options.getString("access_code", true)

      // Call the unbind API
      const response = await fetch(`${WEBAPP_URL}/api/unbind-device`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, accessCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorEmbed = new EmbedBuilder()
          .setColor(0xFF0000)
          .setTitle("❌ Unbind Failed")
          .setDescription(data.error || "Failed to unbind device")
          .setTimestamp()

        await interaction.editReply({ embeds: [errorEmbed] })
        return
      }

      const successEmbed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle("🔓 Device Unbound")
        .setDescription("The document is no longer locked to any device.")
        .addFields(
          { name: "📄 Document ID", value: docId, inline: true },
          { name: "👤 Customer", value: data.customerId || "Unknown", inline: true },
          { name: "📊 Previous Device", value: data.previousDevice ? `${data.previousDevice.slice(0, 8)}...` : "None", inline: true },
        )
        .setFooter({ text: "The next person to access will bind the document to their device" })
        .setTimestamp()

      await interaction.editReply({ embeds: [successEmbed] })

    } catch (error) {
      console.error("[unbind] Error:", error)
      
      const errorEmbed = new EmbedBuilder()
        .setColor(0xFF0000)
        .setTitle("❌ Error")
        .setDescription(error instanceof Error ? error.message : "An unexpected error occurred")
        .setTimestamp()

      await interaction.editReply({ embeds: [errorEmbed] })
    }
  },
}






