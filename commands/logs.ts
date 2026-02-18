import { SlashCommandBuilder, type ChatInputCommandInteraction, EmbedBuilder } from "discord.js"

export const logsCommand = {
  data: new SlashCommandBuilder()
    .setName("logs")
    .setDescription("View access logs for a protected document")
    .addStringOption((option) =>
      option
        .setName("doc_id")
        .setDescription("The document ID to check logs for")
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

      const webAppUrl = process.env.WEB_APP_URL || "http://localhost:3000"

      const response = await fetch(`${webAppUrl}/api/access-logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, accessCode }),
      })

      const data = await response.json()

      if (!response.ok) {
        await interaction.editReply({
          content: `❌ ${data.error || "Failed to fetch logs"}`,
        })
        return
      }

      // Build the embed
      const embed = new EmbedBuilder()
        .setTitle(`📊 Access Logs: ${docId.slice(0, 8)}...`)
        .setColor(0x5865F2)
        .addFields(
          { name: "👤 Customer", value: data.customerId || "Unknown", inline: true },
          { name: "📊 Total Views", value: `${data.viewCount || 0}/${data.maxViews || "∞"}`, inline: true },
          { name: "📅 Created", value: data.createdAt ? new Date(data.createdAt).toLocaleDateString() : "Unknown", inline: true },
        )

      // Add expiration info
      if (data.expiresAt) {
        const expiresDate = new Date(data.expiresAt)
        const isExpired = expiresDate < new Date()
        embed.addFields({
          name: "⏰ Expires",
          value: isExpired ? "❌ EXPIRED" : expiresDate.toLocaleString(),
          inline: true,
        })
      }

      // Add last access info
      if (data.lastViewedAt) {
        embed.addFields({
          name: "🕐 Last Accessed",
          value: new Date(data.lastViewedAt).toLocaleString(),
          inline: true,
        })
      }

      if (data.lastViewedIP) {
        embed.addFields({
          name: "🌐 Last IP",
          value: `\`${data.lastViewedIP}\``,
          inline: true,
        })
      }

      // Build access log table
      const accessLog = data.accessLog || []
      
      if (accessLog.length > 0) {
        // Show last 10 accesses
        const recentLogs = accessLog.slice(-10).reverse()
        
        let logText = ""
        for (const log of recentLogs) {
          const time = new Date(log.timestamp).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })
          
          // Parse device from user agent
          let device = "🖥️"
          if (log.userAgent?.includes("iPhone")) device = "📱"
          else if (log.userAgent?.includes("Android")) device = "📱"
          else if (log.userAgent?.includes("Windows")) device = "💻"
          else if (log.userAgent?.includes("Mac")) device = "🍎"
          
          logText += `${device} View #${log.viewNumber} • \`${log.ip}\` • ${time}\n`
        }

        embed.addFields({
          name: `📋 Recent Access (${accessLog.length} total)`,
          value: logText || "No access logs",
          inline: false,
        })
      } else {
        embed.addFields({
          name: "📋 Access Log",
          value: "No one has accessed this document yet",
          inline: false,
        })
      }

      embed.setFooter({ text: "Access logs are stored for security purposes" })
      embed.setTimestamp()

      await interaction.editReply({ embeds: [embed] })

    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error"
      await interaction.editReply({
        content: `❌ Error fetching logs: ${errMsg}`,
      })
    }
  },
}
