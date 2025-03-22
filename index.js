
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionsBitField, REST, Routes, InteractionResponseFlags } = require('discord.js');
const { QuickDB } = require('quick.db');
require('dotenv').config();

const db = new QuickDB();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers
  ]
});

const config = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  pollChannel: null,
  moderatorRole: null,
  pendingPolls: new Map(),
  activePolls: new Map()
};

if (!config.token || !config.clientId) {
  console.error('Error: Missing environment variables!');
  process.exit(1);
}

async function initSettings() {
  try {
    const settings = await db.get('settings') || {};
    config.pollChannel = settings.pollChannel || null;
    config.moderatorRole = settings.moderatorRole || null;
    config.activePolls = new Map(settings.activePolls || []);
    console.log('Settings loaded successfully');
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

async function saveSettings() {
  try {
    const settings = {
      pollChannel: config.pollChannel,
      moderatorRole: config.moderatorRole,
      activePolls: Array.from(config.activePolls.entries())
    };
    await db.set('settings', settings);
    return true;
  } catch (error) {
    console.error('Error saving settings:', error);
    return false;
  }
}

const reactionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const commands = [
  new SlashCommandBuilder()
    .setName('setpollchannel')
    .setDescription('تنظیم کانال نظرسنجی 📍')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
  new SlashCommandBuilder()
    .setName('setmoderatorrole')
    .setDescription('تنظیم رول تأییدکننده 🛡️')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('رول تأییدکننده')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('ساخت نظرسنجی جدید 📝')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('سوال نظرسنجی')
        .setRequired(true)
        .setMaxLength(256))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('گزینه‌ها (با | جدا کنید)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('مدت زمان (ساعت)')
        .setMinValue(1)
        .setMaxValue(168))
    .addBooleanOption(option =>
      option.setName('anonymous')
        .setDescription('حالت ناشناس')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('approvepoll')
    .setDescription('تأیید نظرسنجی ✅')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('آیدی نظرسنجی')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('rejectpoll')
    .setDescription('رد نظرسنجی ❌')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('آیدی نظرسنجی')
        .setRequired(true))
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('Commands registered successfully');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

function startPollChecker() {
  setInterval(async () => {
    for (const [messageId, poll] of config.activePolls.entries()) {
      try {
        if (Date.now() >= poll.endTime) {
          await endPoll(messageId);
        } else {
          const channel = await client.channels.fetch(config.pollChannel);
          const message = await channel.messages.fetch(messageId);
          const embed = message.embeds[0];
          const remainingTime = Math.floor((poll.endTime - Date.now()) / 60000);
          
          const updatedEmbed = new EmbedBuilder(embed.data)
            .spliceFields(2, 1, { name: '⏱️ زمان باقیمانده', value: `${remainingTime} دقیقه`, inline: true });
          
          await message.edit({ embeds: [updatedEmbed] });
        }
      } catch (error) {
        console.error('Error updating poll:', error);
      }
    }
  }, 60000);
}

async function endPoll(messageId) {
  const poll = config.activePolls.get(messageId);
  if (!poll) return;

  try {
    const channel = await client.channels.fetch(config.pollChannel);
    const message = await channel.messages.fetch(messageId);
    const reactions = message.reactions.cache;

    const results = poll.options.map((opt, i) => {
      const reaction = reactions.get(reactionEmojis[i]);
      const count = reaction ? reaction.count - 1 : 0;
      return { option: opt, count };
    });

    const totalVotes = results.reduce((sum, r) => sum + r.count, 0);

    const embed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('📊 نتایج نظرسنجی')
      .addFields(
        { name: '❓ سوال', value: poll.question, inline: false },
        { name: '📋 نتایج', value: results.map((r, i) => 
          `${reactionEmojis[i]} ${r.option}: ${r.count} رأی (${totalVotes > 0 ? ((r.count/totalVotes)*100).toFixed(1) : 0}%)`
        ).join('\n'), inline: false }
      )
      .setFooter({ text: poll.anonymous ? 'نظرسنجی ناشناس 🔒' : `ایجاد شده توسط ${poll.creatorName}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    config.activePolls.delete(messageId);
    await saveSettings();
  } catch (error) {
    console.error('Error in endPoll:', error);
  }
}

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  initSettings().then(() => {
    registerCommands();
    startPollChecker();
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'setpollchannel':
        config.pollChannel = interaction.channelId;
        if (await saveSettings()) {
          await interaction.reply({ content: '✅ کانال نظرسنجی با موفقیت تنظیم شد', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ خطا در تنظیم کانال', ephemeral: true });
        }
        break;

      case 'setmoderatorrole':
        config.moderatorRole = interaction.options.getRole('role').id;
        if (await saveSettings()) {
          await interaction.reply({ content: '✅ رول تأییدکننده با موفقیت تنظیم شد', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ خطا در تنظیم رول', ephemeral: true });
        }
        break;

      case 'createpoll':
        if (!config.pollChannel || !config.moderatorRole) {
          await interaction.reply({ content: '❌ لطفاً ابتدا کانال و رول را تنظیم کنید', ephemeral: true });
          return;
        }

        const pollId = Date.now().toString();
        const poll = {
          question: interaction.options.getString('question'),
          options: interaction.options.getString('options').split('|').map(o => o.trim()),
          duration: (interaction.options.getInteger('duration') || 24) * 3600000,
          creator: interaction.user.id,
          creatorName: interaction.user.username,
          endTime: Date.now() + ((interaction.options.getInteger('duration') || 24) * 3600000),
          anonymous: interaction.options.getBoolean('anonymous') || false
        };

        if (poll.options.length < 2 || poll.options.length > 5) {
          await interaction.reply({ content: '❌ نظرسنجی باید بین 2 تا 5 گزینه داشته باشد', ephemeral: true });
          return;
        }

        config.pendingPolls.set(pollId, poll);

        const embed = new EmbedBuilder()
          .setTitle('📊 نظرسنجی در انتظار تأیید')
          .addFields(
            { name: '❓ سوال', value: poll.question, inline: false },
            { name: '📋 گزینه‌ها', value: poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
            { name: '⏱️ مدت زمان', value: `${poll.duration / 3600000} ساعت`, inline: true },
            { name: '🔑 شناسه', value: pollId, inline: true }
          )
          .setFooter({ text: poll.anonymous ? 'نظرسنجی ناشناس 🔒' : `ایجاد شده توسط ${poll.creatorName}` })
          .setTimestamp();

        await interaction.reply({ content: '✅ نظرسنجی شما ایجاد و در انتظار تأیید است', ephemeral: true });
        const message = await interaction.channel.send({ 
          content: `<@&${config.moderatorRole}> یک نظرسنجی جدید نیاز به تأیید دارد!`,
          embeds: [embed],
          ephemeral: true 
        });

        for (const emoji of reactionEmojis.slice(0, poll.options.length)) {
          await message.react(emoji);
        }
        break;

      case 'approvepoll':
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          await interaction.reply({ content: '❌ شما دسترسی تأیید نظرسنجی را ندارید', ephemeral: true });
          return;
        }

        const pollToApprove = config.pendingPolls.get(interaction.options.getString('pollid'));
        if (!pollToApprove) {
          await interaction.reply({ content: '❌ نظرسنجی مورد نظر یافت نشد', ephemeral: true });
          return;
        }

        const channel = await client.channels.fetch(config.pollChannel);
        const pollEmbed = new EmbedBuilder()
          .setTitle('📊 نظرسنجی')
          .addFields(
            { name: '❓ سوال', value: pollToApprove.question, inline: false },
            { name: '📋 گزینه‌ها', value: pollToApprove.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
            { name: '⏱️ زمان باقیمانده', value: `${Math.floor((pollToApprove.endTime - Date.now()) / 60000)} دقیقه`, inline: true }
          )
          .setFooter({ text: pollToApprove.anonymous ? 'نظرسنجی ناشناس 🔒' : `ایجاد شده توسط ${pollToApprove.creatorName}` })
          .setTimestamp();

        const msg = await channel.send({ embeds: [pollEmbed] });
        for (const emoji of reactionEmojis.slice(0, pollToApprove.options.length)) {
          await msg.react(emoji);
        }

        config.activePolls.set(msg.id, pollToApprove);
        config.pendingPolls.delete(interaction.options.getString('pollid'));
        await saveSettings();

        await interaction.reply({ content: '✅ نظرسنجی با موفقیت تأیید شد', ephemeral: true });
        break;

      case 'rejectpoll':
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          await interaction.reply({ content: '❌ شما دسترسی رد نظرسنجی را ندارید', ephemeral: true });
          return;
        }

        if (config.pendingPolls.delete(interaction.options.getString('pollid'))) {
          await interaction.reply({ content: '✅ نظرسنجی با موفقیت رد شد', ephemeral: true });
        } else {
          await interaction.reply({ content: '❌ نظرسنجی مورد نظر یافت نشد', ephemeral: true });
        }
        break;
    }
  } catch (error) {
    console.error('Error in command:', error);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: '❌ خطایی رخ داد', ephemeral: true }).catch(console.error);
    }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  const poll = config.activePolls.get(reaction.message.id);
  if (!poll) return;

  const emoji = reaction.emoji.name;
  const validIndex = reactionEmojis.indexOf(emoji);

  if (validIndex === -1 || validIndex >= poll.options.length) {
    await reaction.users.remove(user);
  }
});

client.login(config.token).catch(console.error);
