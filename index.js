
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
    console.log('🚀 تنظیمات با موفقیت بارگذاری شد');
  } catch (error) {
    console.error('خطا در بارگذاری تنظیمات:', error);
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
    console.error('خطا در ذخیره تنظیمات:', error);
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
        .setMaxValue(168)),
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
    console.log('✅ دستورات با موفقیت ثبت شدند');
  } catch (error) {
    console.error('خطا در ثبت دستورات:', error);
  }
}

function startPollChecker() {
  setInterval(async () => {
    for (const [messageId, poll] of config.activePolls.entries()) {
      if (Date.now() >= poll.endTime) {
        try {
          await endPoll(messageId);
        } catch (error) {
          console.error('خطا در پایان نظرسنجی:', error);
        }
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
      .setFooter({ text: `مجموع آرا: ${totalVotes} | نظرسنجی پایان یافت 🎉` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    config.activePolls.delete(messageId);
    await saveSettings();
  } catch (error) {
    console.error('خطا در پایان نظرسنجی:', error);
  }
}

client.once('ready', () => {
  console.log(`🚀 ربات به عنوان ${client.user.tag} وارد شد 🎉`);
  initSettings().then(() => {
    registerCommands();
    startPollChecker();
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  await interaction.deferReply({ flags: InteractionResponseFlags.Ephemeral });

  try {
    switch (interaction.commandName) {
      case 'setpollchannel':
        config.pollChannel = interaction.channelId;
        if (await saveSettings()) {
          await interaction.editReply({ content: '✅ کانال نظرسنجی با موفقیت تنظیم شد' });
        } else {
          await interaction.editReply({ content: '❌ خطا در تنظیم کانال' });
        }
        break;

      case 'setmoderatorrole':
        config.moderatorRole = interaction.options.getRole('role').id;
        if (await saveSettings()) {
          await interaction.editReply({ content: '✅ رول تأییدکننده با موفقیت تنظیم شد' });
        } else {
          await interaction.editReply({ content: '❌ خطا در تنظیم رول' });
        }
        break;

      case 'createpoll':
        if (!config.pollChannel || !config.moderatorRole) {
          await interaction.editReply({ content: '❌ لطفاً ابتدا کانال و رول را تنظیم کنید' });
          return;
        }

        const pollId = Date.now().toString();
        const poll = {
          question: interaction.options.getString('question'),
          options: interaction.options.getString('options').split('|').map(o => o.trim()),
          duration: (interaction.options.getInteger('duration') || 24) * 3600000,
          creator: interaction.user.id,
          endTime: Date.now() + ((interaction.options.getInteger('duration') || 24) * 3600000)
        };

        if (poll.options.length < 2 || poll.options.length > 5) {
          await interaction.editReply({ content: '❌ نظرسنجی باید بین 2 تا 5 گزینه داشته باشد' });
          return;
        }

        config.pendingPolls.set(pollId, poll);

        const embed = new EmbedBuilder()
          .setTitle('📊 نظرسنجی جدید')
          .addFields(
            { name: '❓ سوال', value: poll.question, inline: false },
            { name: '📋 گزینه‌ها', value: poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
            { name: '⏱️ مدت زمان', value: `${poll.duration / 3600000} ساعت`, inline: true },
            { name: '🔑 شناسه', value: pollId, inline: true }
          )
          .setFooter({ text: 'در انتظار تأیید مدیران...' })
          .setTimestamp();

        const message = await interaction.channel.send({ 
          content: `<@&${config.moderatorRole}> یک نظرسنجی جدید نیاز به تأیید دارد! 🔔`,
          embeds: [embed]
        });

        for (const emoji of reactionEmojis.slice(0, poll.options.length)) {
          await message.react(emoji);
        }

        await interaction.editReply({ content: '✅ نظرسنجی شما ایجاد و در انتظار تأیید است' });
        break;

      case 'approvepoll':
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          await interaction.editReply({ content: '❌ شما دسترسی تأیید نظرسنجی را ندارید' });
          return;
        }

        const pollToApprove = config.pendingPolls.get(interaction.options.getString('pollid'));
        if (!pollToApprove) {
          await interaction.editReply({ content: '❌ نظرسنجی مورد نظر یافت نشد' });
          return;
        }

        const channel = await client.channels.fetch(config.pollChannel);
        const pollEmbed = new EmbedBuilder()
          .setTitle('📊 نظرسنجی فعال')
          .addFields(
            { name: '❓ سوال', value: pollToApprove.question, inline: false },
            { name: '📋 گزینه‌ها', value: pollToApprove.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
            { name: '⏱️ زمان باقیمانده', value: `<t:${Math.floor(pollToApprove.endTime / 1000)}:R>`, inline: true }
          )
          .setTimestamp();

        const msg = await channel.send({ embeds: [pollEmbed] });
        for (const emoji of reactionEmojis.slice(0, pollToApprove.options.length)) {
          await msg.react(emoji);
        }

        config.activePolls.set(msg.id, pollToApprove);
        config.pendingPolls.delete(interaction.options.getString('pollid'));
        await saveSettings();

        await interaction.editReply({ content: '✅ نظرسنجی با موفقیت تأیید شد' });
        break;

      case 'rejectpoll':
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          await interaction.editReply({ content: '❌ شما دسترسی رد نظرسنجی را ندارید' });
          return;
        }

        if (!config.pendingPolls.has(interaction.options.getString('pollid'))) {
          await interaction.editReply({ content: '❌ نظرسنجی مورد نظر یافت نشد' });
          return;
        }

        config.pendingPolls.delete(interaction.options.getString('pollid'));
        await interaction.editReply({ content: '✅ نظرسنجی با موفقیت رد شد' });
        break;
    }
  } catch (error) {
    console.error('خطا در اجرای دستور:', error);
    try {
      await interaction.editReply({ content: '❌ خطایی رخ داد' });
    } catch (err) {
      console.error('خطا در ارسال پیام خطا:', err);
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
