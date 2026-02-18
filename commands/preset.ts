import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from "discord.js"
import fetch from "node-fetch"
import fs from "fs"
import path from "path"

const DATA_DIR = "./data"
const currentBot = (process.env.BOT || "elyxbook").toLowerCase()
const PRESETS_FILE = path.join(DATA_DIR, `presets-${currentBot}.json`)
const LOGOS_DIR = path.join(DATA_DIR, `logos-${currentBot}`)

if (!fs.existsSync(LOGOS_DIR)) {
  fs.mkdirSync(LOGOS_DIR, { recursive: true })
}

export interface PresetData {
  name: string
  texts: string[]
  position: string
  color: string
  textOpacity: number
  logoOpacity: number
  logoFile: string | null
  createdBy: string
  createdAt: string
}

export function loadPresets(): Record<string, PresetData> {
  if (fs.existsSync(PRESETS_FILE)) {
    return JSON.parse(fs.readFileSync(PRESETS_FILE, "utf-8"))
  }
  return {}
}

function savePresets(presets: Record<string, PresetData>): void {
  fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2))
}

export function getPreset(name: string): PresetData | null {
  const presets = loadPresets()
  return presets[name.toLowerCase()] || null
}

export function getPresetLogoBuffer(preset: PresetData): Buffer | null {
  if (preset.logoFile && fs.existsSync(preset.logoFile)) {
    return fs.readFileSync(preset.logoFile)
  }
  return null
}

export const presetCommand = {
  data: new SlashCommandBuilder()
    .setName("preset")
    .setDescription("Manage watermark presets")
    .addSubcommand((sub) =>
      sub
        .setName("save")
        .setDescription("Save a new watermark preset")
        .addStringOption((o) => o.setName("name").setDescription("Preset name").setRequired(true))
        .addStringOption((o) => o.setName("text1").setDescription("Watermark text 1").setRequired(false))
        .addStringOption((o) => o.setName("text2").setDescription("Watermark text 2").setRequired(false))
        .addStringOption((o) => o.setName("text3").setDescription("Watermark text 3").setRequired(false))
        .addStringOption((o) => o.setName("text4").setDescription("Watermark text 4").setRequired(false))
        .addStringOption((o) => o.setName("text5").setDescription("Watermark text 5").setRequired(false))
        .addAttachmentOption((o) => o.setName("logo").setDescription("Logo image for watermark").setRequired(false))
        .addNumberOption((o) => o.setName("logo_opacity").setDescription("Logo opacity (0.05-1.0, default: 0.15)").setRequired(false).setMinValue(0.05).setMaxValue(1.0))
        .addStringOption((o) =>
          o.setName("position").setDescription("Text watermark position").setRequired(false)
            .addChoices(
              { name: "Diagonal (repeating)", value: "diagonal" },
              { name: "Center", value: "center" },
              { name: "Bottom Right", value: "bottom-right" },
              { name: "Top Left", value: "top-left" }
            )
        )
        .addStringOption((o) =>
          o.setName("color").setDescription("Text watermark color").setRequired(false)
            .addChoices(
              { name: "Neon Orange", value: "neon-orange" },
              { name: "Red", value: "red" },
              { name: "Orange", value: "orange" },
              { name: "Yellow", value: "yellow" },
              { name: "Lime Green", value: "lime" },
              { name: "Green", value: "green" },
              { name: "Cyan", value: "cyan" },
              { name: "Blue", value: "blue" },
              { name: "Navy Blue", value: "navy" },
              { name: "Purple", value: "purple" },
              { name: "Magenta", value: "magenta" },
              { name: "Pink", value: "pink" },
              { name: "Hot Pink", value: "hot-pink" },
              { name: "Gold", value: "gold" },
              { name: "Silver", value: "silver" },
              { name: "Teal", value: "teal" },
              { name: "Turquoise", value: "turquoise" },
              { name: "Coral", value: "coral" },
              { name: "Crimson", value: "crimson" },
              { name: "Violet", value: "violet" },
              { name: "Indigo", value: "indigo" },
              { name: "Maroon", value: "maroon" },
              { name: "Olive", value: "olive" },
              { name: "Gray", value: "gray" },
              { name: "Black", value: "black" }
            )
        )
        .addNumberOption((o) => o.setName("opacity").setDescription("Text opacity (0.1-1.0, default: 0.15)").setRequired(false).setMinValue(0.1).setMaxValue(1.0))
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("List all saved presets")
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a preset")
        .addStringOption((o) => o.setName("name").setDescription("Preset name to delete").setRequired(true))
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ ephemeral: true })
    }

    const sub = interaction.options.getSubcommand()

    if (sub === "save") {
      const name = interaction.options.getString("name", true).toLowerCase().trim()

      if (!/^[a-z0-9_-]+$/.test(name)) {
        await interaction.editReply("❌ Preset name can only contain letters, numbers, hyphens, and underscores.")
        return
      }

      const texts: string[] = []
      for (let i = 1; i <= 5; i++) {
        const t = interaction.options.getString(`text${i}`)
        if (t) texts.push(t)
      }

      const logoAttachment = interaction.options.getAttachment("logo")
      let logoFilePath: string | null = null

      if (logoAttachment) {
        const logoResponse = await fetch(logoAttachment.url)
        let logoBuffer: Buffer
        if (logoResponse.arrayBuffer) {
          logoBuffer = Buffer.from(await logoResponse.arrayBuffer())
        } else {
          logoBuffer = await (logoResponse as any).buffer()
        }
        logoFilePath = path.join(LOGOS_DIR, `${name}.png`)
        const sharp = (await import("sharp")).default
        await sharp(logoBuffer)
          .resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
          .png()
          .toFile(logoFilePath)
      }

      if (texts.length === 0 && !logoAttachment) {
        await interaction.editReply("❌ Provide at least one text or a logo for the preset.")
        return
      }

      const preset: PresetData = {
        name,
        texts,
        position: interaction.options.getString("position") || "diagonal",
        color: interaction.options.getString("color") || "neon-orange",
        textOpacity: interaction.options.getNumber("opacity") || 0.15,
        logoOpacity: interaction.options.getNumber("logo_opacity") || 0.15,
        logoFile: logoFilePath,
        createdBy: interaction.user.username,
        createdAt: new Date().toISOString(),
      }

      const presets = loadPresets()
      const isOverwrite = !!presets[name]
      presets[name] = preset
      savePresets(presets)

      const embed = new EmbedBuilder()
        .setTitle(isOverwrite ? `✅ Preset "${name}" updated` : `✅ Preset "${name}" saved`)
        .setColor(0x00FF00)
        .addFields(
          { name: "Texts", value: texts.length > 0 ? texts.map((t, i) => `${i + 1}. ${t}`).join("\n") : "None", inline: false },
          { name: "Logo", value: logoFilePath ? "Yes" : "No", inline: true },
          { name: "Position", value: preset.position, inline: true },
          { name: "Color", value: preset.color, inline: true },
          { name: "Text Opacity", value: `${Math.round(preset.textOpacity * 100)}%`, inline: true },
          { name: "Logo Opacity", value: `${Math.round(preset.logoOpacity * 100)}%`, inline: true },
        )
        .setFooter({ text: `Use with: /watermark file:<file> preset:${name}` })

      await interaction.editReply({ embeds: [embed] })

    } else if (sub === "list") {
      const presets = loadPresets()
      const keys = Object.keys(presets)

      if (keys.length === 0) {
        await interaction.editReply("No presets saved yet. Use `/preset save` to create one.")
        return
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 Watermark Presets")
        .setColor(0x5865F2)

      for (const key of keys) {
        const p = presets[key]
        const parts: string[] = []
        if (p.texts.length > 0) parts.push(`Text: ${p.texts.join(", ")}`)
        if (p.logoFile) parts.push("Logo: ✅")
        parts.push(`Position: ${p.position}`)
        parts.push(`Color: ${p.color}`)
        if (p.texts.length > 0) parts.push(`Text opacity: ${Math.round(p.textOpacity * 100)}%`)
        if (p.logoFile) parts.push(`Logo opacity: ${Math.round(p.logoOpacity * 100)}%`)

        embed.addFields({ name: `\`${key}\``, value: parts.join(" • "), inline: false })
      }

      embed.setFooter({ text: `${keys.length} preset(s) | Use with: /watermark file:<file> preset:<name>` })

      await interaction.editReply({ embeds: [embed] })

    } else if (sub === "delete") {
      const name = interaction.options.getString("name", true).toLowerCase().trim()
      const presets = loadPresets()

      if (!presets[name]) {
        await interaction.editReply(`❌ Preset "${name}" not found.`)
        return
      }

      if (presets[name].logoFile && fs.existsSync(presets[name].logoFile!)) {
        fs.unlinkSync(presets[name].logoFile!)
      }

      delete presets[name]
      savePresets(presets)

      await interaction.editReply(`✅ Preset "${name}" deleted.`)
    }
  },
}
