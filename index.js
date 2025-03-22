
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionsBitField, REST, Routes } = require('discord.js');
const { QuickDB } = require('quick.db');
require('dotenv').config();

const db = new QuickDB();
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
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

(async () => {
  try {
    config.pollChannel = await db.get('pollChannel');
    config.moderatorRole = await db.get('moderatorRole');
  } catch (error) {
    console.error('Error loading settings:', error);
  }
})();

async function saveSettings() {
  try {
    if (config.pollChannel) {
      await db.set('pollChannel', config.pollChannel);
    }
    if (config.moderatorRole) {
      await db.set('moderatorRole', config.moderatorRole);
    }
  } catch (error) {
    console.error('Error saving settings:', error);
    throw error;
  }
}

const reactionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

const commands = [
  new SlashCommandBuilder()
    .setName('setpollchannel')
    .setDescription('تنظیم کانال برای نظرسنجی‌ها 📍')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
  new SlashCommandBuilder()
    .setName('setmoderatorrole')
    .setDescription('تنظیم رول تأییدکننده نظرسنجی‌ها 🛡️')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('رول تأییدکننده رو انتخاب کن')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('یه نظرسنجی جدید بساز 📝')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('سوال نظرسنجی')
        .setRequired(true)
        .setMaxLength(256))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('گزینه‌ها رو با | جدا کن (مثلاً: بله | خیر)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('مدت زمان نظرسنجی (به ساعت، پیش‌فرض 24)')
        .setMinValue(1)
        .setMaxValue(168)
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('anonymous')
        .setDescription('ناشناس باشه؟ (پیش‌فرض خیر)')
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName('approvepoll')
    .setDescription('تأیید یه نظرسنجی در انتظار ✅')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('آیدی نظرسنجی رو وارد کن')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('rejectpoll')
    .setDescription('رد یه نظرسنجی در انتظار ❌')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('آیدی نظرسنجی رو وارد کن')
        .setRequired(true)),
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('Successfully registered commands! ✅');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

client.once('ready', () => {
  console.log(`🚀 Logged in as ${client.user.tag} 🎉`);
  registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  try {
    if (interaction.commandName === 'setpollchannel') {
      config.pollChannel = interaction.channelId;
      await saveSettings();
      await interaction.reply({ content: '✅ کانال نظرسنجی تنظیم شد! 🎉', ephemeral: true });
    }

    if (interaction.commandName === 'setmoderatorrole') {
      const role = interaction.options.getRole('role');
      config.moderatorRole = role.id;
      await saveSettings();
      await interaction.reply({ content: `✅ رول تأییدکننده تنظیم شد: <@&${role.id}> 🎉`, ephemeral: true });
    }

    if (interaction.commandName === 'createpoll') {
      if (!config.pollChannel || !config.moderatorRole) {
        return interaction.reply({ content: '❌ لطفاً اول کانال و رول تأییدکننده رو تنظیم کنید! 🚨', ephemeral: true });
      }
      if (interaction.channelId !== config.pollChannel) {
        return interaction.reply({ content: `❌ نظرسنجی فقط توی کانال <#${config.pollChannel}> می‌تونه ساخته بشه! 🚫`, ephemeral: true });
      }

      const question = interaction.options.getString('question');
      const optionsString = interaction.options.getString('options');
      const duration = interaction.options.getInteger('duration') || 24;
      const anonymous = interaction.options.getBoolean('anonymous') || false;

      const options = optionsString.split('|').map(opt => opt.trim()).filter(opt => opt);
      if (options.length < 2 || options.length > 5) {
        return interaction.reply({ content: '❌ باید بین 2 تا 5 گزینه بذاری! 🚫', ephemeral: true });
      }

      if (options.some(opt => opt.length > 100)) {
        return interaction.reply({ content: '❌ هر گزینه نباید بیشتر از 100 کاراکتر باشه! 🚫', ephemeral: true });
      }

      const pollId = Date.now().toString();
      const pollData = {
        question,
        options,
        duration: duration * 60 * 60 * 1000,
        anonymous,
        creator: interaction.user.id,
        createdAt: Date.now(),
        votes: new Array(options.length).fill(0),
        voters: new Set()
      };

      config.pendingPolls.set(pollId, pollData);

      const embed = new EmbedBuilder()
        .setColor(0xFFFF00)
        .setTitle('📊 نظرسنجی در انتظار تأیید')
        .setDescription(`**سوال:** ${question}\n**گزینه‌ها:**\n${options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}\n**مدت زمان:** ${duration} ساعت\n**ناشناس:** ${anonymous ? 'بله' : 'خیر'}\n**آیدی نظرسنجی:** ${pollId}`)
        .setFooter({ text: 'در انتظار تأیید توسط مدیران ⏳' })
        .setTimestamp();

      await interaction.reply({ content: `<@&${config.moderatorRole}> یه نظرسنجی جدید در انتظار تأییده! 🚨`, embeds: [embed] });
    }

    if (interaction.commandName === 'approvepoll') {
      if (!interaction.member.roles.cache.has(config.moderatorRole)) {
        return interaction.reply({ content: '❌ فقط مدیران می‌تونن نظرسنجی رو تأیید کنن! 🚫', ephemeral: true });
      }

      const pollId = interaction.options.getString('pollid');
      const pollData = config.pendingPolls.get(pollId);
      if (!pollData) {
        return interaction.reply({ content: '❌ نظرسنجی با این آیدی پیدا نشد! 🚫', ephemeral: true });
      }

      // Check if poll is expired (older than 24 hours)
      if (Date.now() - pollData.createdAt > 24 * 60 * 60 * 1000) {
        config.pendingPolls.delete(pollId);
        return interaction.reply({ content: '❌ این نظرسنجی منقضی شده! لطفاً یک نظرسنجی جدید بسازید. 🚫', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setColor(0x00FF00)
        .setTitle('📊 نظرسنجی جدید')
        .setDescription(`**سوال:** ${pollData.question}\n\n${pollData.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}\n\n**مدت زمان:** ${pollData.duration / (60 * 60 * 1000)} ساعت`)
        .setFooter({ text: pollData.anonymous ? 'نظرسنجی ناشناس' : `ایجاد شده توسط ${interaction.guild.members.cache.get(pollData.creator)?.displayName}` })
        .setTimestamp();

      const channel = await client.channels.fetch(config.pollChannel);
      const message = await channel.send({ embeds: [embed] });

      for (const emoji of reactionEmojis.slice(0, pollData.options.length)) {
        await message.react(emoji);
      }

      config.activePolls.set(message.id, { ...pollData, messageId: message.id });
      config.pendingPolls.delete(pollId);

      setTimeout(async () => {
        try {
          const activePoll = config.activePolls.get(message.id);
          if (!activePoll) return;

          const updatedMessage = await channel.messages.fetch(message.id);
          const reactions = updatedMessage.reactions.cache;
          const results = activePoll.options.map((opt, i) => {
            const reaction = reactions.get(reactionEmojis[i]);
            const count = reaction ? reaction.count - 1 : 0;
            return { option: opt, count };
          });

          const totalVotes = results.reduce((sum, result) => sum + result.count, 0);
          const resultEmbed = new EmbedBuilder()
            .setColor(0xFF0000)
            .setTitle('📊 نتیجه نظرسنجی')
            .setDescription(`**سوال:** ${activePoll.question}\n\n**نتایج:**\n${results.map((res, i) => {
              const percentage = totalVotes > 0 ? ((res.count / totalVotes) * 100).toFixed(1) : 0;
              return `${reactionEmojis[i]} ${res.option}: ${res.count} رأی (${percentage}%)`;
            }).join('\n')}\n\n**مجموع آرا:** ${totalVotes}`)
            .setFooter({ text: 'نظرسنجی تموم شد! 🎉' })
            .setTimestamp();

          await channel.send({ embeds: [resultEmbed] });
          config.activePolls.delete(message.id);
        } catch (error) {
          console.error('Error ending poll:', error);
        }
      }, pollData.duration);

      await interaction.reply({ content: '✅ نظرسنجی تأیید و منتشر شد! 🎉', ephemeral: true });
    }

    if (interaction.commandName === 'rejectpoll') {
      if (!interaction.member.roles.cache.has(config.moderatorRole)) {
        return interaction.reply({ content: '❌ فقط مدیران می‌تونن نظرسنجی رو رد کنن! 🚫', ephemeral: true });
      }

      const pollId = interaction.options.getString('pollid');
      if (!config.pendingPolls.has(pollId)) {
        return interaction.reply({ content: '❌ نظرسنجی با این آیدی پیدا نشد! 🚫', ephemeral: true });
      }

      config.pendingPolls.delete(pollId);
      await interaction.reply({ content: '❌ نظرسنجی رد شد! 🚫', ephemeral: true });
    }
  } catch (error) {
    console.error('Command error:', error);
    const response = '❌ خطایی رخ داد! لطفاً دوباره تلاش کنید. 🚨';
    try {
      if (interaction.replied) {
        await interaction.editReply({ content: response });
      } else {
        await interaction.reply({ content: response, ephemeral: true });
      }
    } catch (err) {
      console.error('Error handling failed:', err);
    }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  const messageId = reaction.message.id;
  const poll = config.activePolls.get(messageId);
  if (!poll) return;

  const emoji = reaction.emoji.name;
  const optionIndex = reactionEmojis.indexOf(emoji);
  if (optionIndex === -1 || optionIndex >= poll.options.length) {
    await reaction.users.remove(user.id);
    return;
  }

  if (poll.voters.has(user.id)) {
    await reaction.users.remove(user.id);
    return;
  }

  poll.voters.add(user.id);
  poll.votes[optionIndex]++;
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  const messageId = reaction.message.id;
  const poll = config.activePolls.get(messageId);
  if (!poll) return;

  const emoji = reaction.emoji.name;
  const optionIndex = reactionEmojis.indexOf(emoji);
  if (optionIndex === -1 || optionIndex >= poll.options.length) return;

  if (poll.voters.has(user.id)) {
    poll.voters.delete(user.id);
    poll.votes[optionIndex]--;
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.login(config.token).catch(console.error);
