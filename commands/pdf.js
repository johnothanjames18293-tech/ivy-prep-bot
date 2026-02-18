const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pdf')
    .setDescription('Generate a solved PDF from a CB test URL')
    .addStringOption(option =>
      option.setName('url')
        .setDescription('The College Board test URL')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('brand')
        .setDescription('Choose the PDF brand/style')
        .setRequired(true)
        .addChoices(
          { name: 'Ekon & Flux', value: 'ekon' },
          { name: 'Other SAT', value: 'other' }
        ))
    .addStringOption(option =>
      option.setName('watermark')
        .setDescription('Watermark style (Ekon & Flux only)')
        .setRequired(false)
        .addChoices(
          { name: 'Gray (Standard)', value: 'gray' },
          { name: 'Gold (Premium)', value: 'gold' },
          { name: 'Himan Special', value: 'himan' },
          { name: 'YSL Edition', value: 'ysl' }
        ))
    .addStringOption(option =>
      option.setName('paraphrase')
        .setDescription('Paraphrase 70% of questions?')
        .setRequired(false)
        .addChoices(
          { name: 'Yes - Paraphrased', value: 'yes' },
          { name: 'No - Original', value: 'no' }
        )),

  async execute(interaction) {
    const url = interaction.options.getString('url');
    const brand = interaction.options.getString('brand');
    const watermark = interaction.options.getString('watermark') || 'gray';
    const paraphraseOption = interaction.options.getString('paraphrase') || 'no';
    const paraphrase = paraphraseOption === 'yes';

    const finalWatermark = brand === 'other' ? 'none' : watermark;
    const brandLabel = brand === 'ekon' ? 'Ekon & Flux' : 'Other SAT';

    await interaction.deferReply();

    try {
      await interaction.editReply(`Starting ${brandLabel} PDF generation...\nURL: ${url}\nWatermark: ${brand === 'other' ? 'None (Clean)' : finalWatermark}\nParaphrase: ${paraphrase ? 'Yes' : 'No'}`);

      const response = await axios.post('http://localhost:3000/api/generate-pdf', {
        url: url,
        eventName: `${brandLabel} Practice Test`,
        watermarkMode: finalWatermark,
        paraphrase: paraphrase,
        brand: brand
      }, {
        responseType: 'arraybuffer',
        timeout: 600000
      });

      const pdfBuffer = Buffer.from(response.data);
      const attachment = new AttachmentBuilder(pdfBuffer, { name: `${brandLabel.replace(/ /g, '_')}_Practice_Test.pdf` });

      await interaction.editReply({
        content: `${brandLabel} PDF generated successfully!${paraphrase ? ' (Paraphrased)' : ''}`,
        files: [attachment]
      });

    } catch (error) {
      console.error('Error:', error.message);
      await interaction.editReply(`Error generating PDF: ${error.message}`);
    }
  },
};
