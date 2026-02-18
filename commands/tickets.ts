import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ModalSubmitInteraction,
  ChannelType,
  PermissionFlagsBits,
  ButtonInteraction,
  TextChannel,
  CategoryChannel,
  type GuildMember,
} from "discord.js"
import fs from "fs"
import path from "path"

const DATA_DIR = "./data"
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json")

interface TicketConfig {
  ticketCounters: Record<string, number>
  staffRoles: string[]
  categoryIds: Record<string, string>
}

function loadTicketData(): TicketConfig {
  if (fs.existsSync(TICKETS_FILE)) {
    const data = JSON.parse(fs.readFileSync(TICKETS_FILE, "utf-8"))
    if (!data.ticketCounters) data.ticketCounters = {}
    return data
  }
  return { ticketCounters: {}, staffRoles: [], categoryIds: {} }
}

function saveTicketData(data: TicketConfig): void {
  fs.writeFileSync(TICKETS_FILE, JSON.stringify(data, null, 2))
}

const CATEGORIES: Record<string, string> = {
  olympiads: "Olympiads/Competitions",
  standardized: "Standardized Testing",
  other: "Other Prep",
}

// ============ TICKET SETUP COMMAND ============
export const ticketSetupCommand = {
  data: new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Set up the ticket creation panel in this channel")
    .addRoleOption((o) =>
      o.setName("staff_role_1").setDescription("Role that can see all tickets").setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName("staff_role_2").setDescription("Additional role that can see all tickets").setRequired(false)
    )
    .addRoleOption((o) =>
      o.setName("staff_role_3").setDescription("Additional role that can see all tickets").setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true })
    }

    const guild = interaction.guild
    if (!guild) {
      await interaction.editReply("❌ This command can only be used in a server.")
      return
    }

    // Collect staff roles
    const staffRoles: string[] = []
    for (let i = 1; i <= 3; i++) {
      const role = interaction.options.getRole(`staff_role_${i}`)
      if (role) staffRoles.push(role.id)
    }

    // Create/find category channels for the 3 ticket types
    const ticketData = loadTicketData()
    ticketData.staffRoles = staffRoles

    for (const [key, label] of Object.entries(CATEGORIES)) {
      const categoryName = `📁 ${label}`
      let category = guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildCategory && ch.name === categoryName
      ) as CategoryChannel | undefined

      if (!category) {
        category = await guild.channels.create({
          name: categoryName,
          type: ChannelType.GuildCategory,
        })
      }

      ticketData.categoryIds[key] = category.id
    }

    // Create/find the Closed Tickets category
    const closedCategoryName = "🔒 Closed Tickets"
    let closedCategory = guild.channels.cache.find(
      (ch) => ch.type === ChannelType.GuildCategory && ch.name === closedCategoryName
    ) as CategoryChannel | undefined

    if (!closedCategory) {
      closedCategory = await guild.channels.create({
        name: closedCategoryName,
        type: ChannelType.GuildCategory,
      })
    }

    ticketData.categoryIds["closed"] = closedCategory.id

    saveTicketData(ticketData)

    // Build the ticket panel embed + button
    const embed = new EmbedBuilder()
      .setTitle("🎓 Ivy College Prep — Support")
      .setDescription(
        "Need help with exam prep? Click the button below to open a ticket.\n\n" +
        "A member of our team will assist you shortly."
      )
      .setColor(0x2ECC71)
      .setFooter({ text: "Ivy College Prep" })

    const button = new ButtonBuilder()
      .setCustomId("ticket_create")
      .setLabel("Create Ticket")
      .setStyle(ButtonStyle.Success)
      .setEmoji("🎫")

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button)

    const channel = interaction.channel as TextChannel
    await channel.send({ embeds: [embed], components: [row] })

    await interaction.editReply("✅ Ticket panel created! Staff roles saved.")
  },
}

// ============ BUTTON HANDLER: Create Ticket ============
export async function handleTicketButton(interaction: ButtonInteraction) {
  if (interaction.customId !== "ticket_create") return

  const menu = new StringSelectMenuBuilder()
    .setCustomId("ticket_category")
    .setPlaceholder("Select a category...")
    .addOptions(
      { label: "Olympiads / Competitions", value: "olympiads", emoji: "🏆" },
      { label: "Standardized Testing", value: "standardized", emoji: "📝" },
      { label: "Other Prep", value: "other", emoji: "📚" },
    )

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)

  await interaction.reply({
    content: "**What exam prep are you interested in?**",
    components: [row],
    ephemeral: true,
  })
}

// ============ SELECT MENU HANDLER: Category chosen ============
export async function handleTicketSelect(interaction: StringSelectMenuInteraction) {
  if (interaction.customId !== "ticket_category") return

  const category = interaction.values[0]
  const label = CATEGORIES[category] || "Exam"

  const modal = new ModalBuilder()
    .setCustomId(`ticket_modal_${category}`)
    .setTitle("Ivy College Prep — New Ticket")

  const shortLabel = category === "olympiads" ? "competition" : category === "standardized" ? "test" : "subject"
  const examInput = new TextInputBuilder()
    .setCustomId("exam_name")
    .setLabel(`What ${shortLabel} are you interested in?`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("e.g. SAT, AMC, AP Physics, IELTS...")
    .setRequired(true)
    .setMaxLength(50)

  const detailsInput = new TextInputBuilder()
    .setCustomId("details")
    .setLabel("Any additional details? (optional)")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(500)

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(examInput),
    new ActionRowBuilder<TextInputBuilder>().addComponents(detailsInput),
  )

  await interaction.showModal(modal)
}

// ============ MODAL HANDLER: Create the ticket channel ============
export async function handleTicketModal(interaction: ModalSubmitInteraction) {
  if (!interaction.customId.startsWith("ticket_modal_")) return

  await interaction.deferReply({ ephemeral: true })

  const categoryKey = interaction.customId.replace("ticket_modal_", "")
  const examName = interaction.fields.getTextInputValue("exam_name").trim()
  const details = interaction.fields.getTextInputValue("details")?.trim() || ""

  const guild = interaction.guild
  if (!guild) {
    await interaction.editReply("❌ Something went wrong.")
    return
  }

  const ticketData = loadTicketData()

  const examClean = examName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().replace(/-+/g, "-").replace(/^-|-$/g, "")
  const counterKey = examClean
  if (!ticketData.ticketCounters[counterKey]) ticketData.ticketCounters[counterKey] = 0
  ticketData.ticketCounters[counterKey]++
  const ticketNum = ticketData.ticketCounters[counterKey]
  const username = interaction.user.username.toLowerCase()
  const channelName = `${examClean}-ticket${ticketNum}-${username}`

  // Find the category channel
  const parentId = ticketData.categoryIds[categoryKey]

  // Permission overwrites: deny @everyone, allow the user + staff roles
  const permissionOverwrites: any[] = [
    {
      id: guild.id,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
  ]

  for (const roleId of ticketData.staffRoles) {
    permissionOverwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageMessages,
      ],
    })
  }

  try {
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: parentId || undefined,
      permissionOverwrites,
    })

    saveTicketData(ticketData)

    // Find the Management role
    const managementRole = guild.roles.cache.find(
      (role) => role.name.toLowerCase() === "management"
    )

    // Welcome embed in the ticket
    const categoryLabel = CATEGORIES[categoryKey] || "General"
    const managementMention = managementRole ? `<@&${managementRole.id}>` : "Our team"
    const welcomeEmbed = new EmbedBuilder()
      .setTitle(`🎫 Ticket #${ticketNum}`)
      .setDescription(
        `Welcome <@${interaction.user.id}>!\n\n` +
        `**Category:** ${categoryLabel}\n` +
        `**Interest:** ${examName}\n` +
        (details ? `**Details:** ${details}\n\n` : "\n") +
        `${managementMention} will be with you shortly.`
      )
      .setColor(0x2ECC71)
      .setTimestamp()

    const closeButton = new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🔒")

    const closeRow = new ActionRowBuilder<ButtonBuilder>().addComponents(closeButton)

    await ticketChannel.send({ embeds: [welcomeEmbed], components: [closeRow] })

    // Ping Management role
    if (managementRole) {
      const pingMsg = await ticketChannel.send({ content: `<@&${managementRole.id}>` })
      await pingMsg.delete().catch(() => {})
    }

    await interaction.editReply(`✅ Your ticket has been created: <#${ticketChannel.id}>`)

  } catch (error) {
    console.error("[Tickets] Error creating ticket:", error)
    await interaction.editReply("❌ Failed to create ticket. Make sure the bot has permission to create channels.")
  }
}

// ============ CLOSE TICKET BUTTON ============
export async function handleTicketClose(interaction: ButtonInteraction) {
  if (interaction.customId !== "ticket_close") return

  await interaction.reply({
    content: "⚠️ Are you sure you want to close this ticket?",
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_close_confirm")
          .setLabel("Yes, close it")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("ticket_close_cancel")
          .setLabel("Cancel")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
    ephemeral: true,
  })
}

export async function handleTicketCloseConfirm(interaction: ButtonInteraction) {
  if (interaction.customId === "ticket_close_cancel") {
    await interaction.update({ content: "Cancelled.", components: [] })
    return
  }

  if (interaction.customId !== "ticket_close_confirm") return

  const channel = interaction.channel as TextChannel
  if (!channel) return

  // Prevent double-closing
  if (channel.name.startsWith("closed-")) {
    await interaction.update({ content: "This ticket is already closed.", components: [] })
    return
  }

  await interaction.update({ content: "🔒 Closing ticket...", components: [] })

  const closeEmbed = new EmbedBuilder()
    .setTitle("🔒 Ticket Closed")
    .setDescription(`Closed by <@${interaction.user.id}>`)
    .setColor(0xE74C3C)
    .setTimestamp()

  await channel.send({ embeds: [closeEmbed] })

  try {
    // Hide ticket from customers — deny ViewChannel for all member overwrites
    const overwrites = channel.permissionOverwrites.cache
    for (const [id, overwrite] of overwrites) {
      if (id === channel.guild.id) continue
      if (overwrite.type === 1) {
        await channel.permissionOverwrites.edit(id, {
          ViewChannel: false,
          SendMessages: false,
        })
      }
    }

    await channel.setName(`closed-${channel.name}`)

    // Move to Closed Tickets category
    const ticketData = loadTicketData()
    const closedCategoryId = ticketData.categoryIds["closed"]
    if (closedCategoryId) {
      await channel.setParent(closedCategoryId, { lockPermissions: false })
    }
  } catch (error) {
    console.error("[Tickets] Error closing ticket:", error)
  }
}

// ============ TICKET DELETE COMMAND ============
export const ticketDeleteCommand = {
  data: new SlashCommandBuilder()
    .setName("deleteticket")
    .setDescription("Permanently delete this ticket channel"),

  async execute(interaction: ChatInputCommandInteraction) {
    const channel = interaction.channel as TextChannel
    if (!channel) {
      await interaction.reply({ content: "❌ This command can only be used in a channel.", ephemeral: true })
      return
    }

    if (!channel.name.includes("ticket")) {
      await interaction.reply({ content: "❌ This doesn't look like a ticket channel.", ephemeral: true })
      return
    }

    await interaction.reply({ content: "🗑️ Deleting ticket..." })

    try {
      await channel.delete("Ticket deleted by staff")
    } catch (error) {
      console.error("[Tickets] Error deleting ticket:", error)
    }
  },
}
