
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionsBitField, REST, Routes, InteractionResponseFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
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

const COLORS = {
  SUCCESS: 0x4ade80,
  ERROR: 0xef4444,
  PENDING: 0xf97316,
  ACTIVE: 0x3b82f6,
  PING: 0x10b981
};

const EMOJIS = {
  SUCCESS: '✅',
  ERROR: '❌',
  QUESTION: '❓',
  OPTIONS: '📋',
  DURATION: '⏱️',
  ID: '🔑',
  ANONYMOUS: '🔒',
  TIME_REMAINING: '⏳',
  TOTAL_VOTES: '📊',
  PING: '🌐',
  SETTINGS: '⚙️'
};

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
    console.log('✨ تنظیمات با موفقیت بارگذاری شد');
  } catch (error) {
    console.error('❌ خطا در بارگذاری تنظیمات:', error);
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
    .setName('ping')
    .setDescription('نمایش وضعیت ربات 🚀'),
  new SlashCommandBuilder()
    .setName('setpollchannel')
    .setDescription('تنظیم کانال نظرسنجی 📝')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
  new SlashCommandBuilder()
    .setName('setmoderatorrole')
    .setDescription('تنظیم رول تأییدکننده 👑')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('رول مورد نظر برای تأیید')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('ایجاد نظرسنجی جدید ✨')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('سوال نظرسنجی')
        .setRequired(true)
        .setMaxLength(256))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('گزینه‌ها (با | جدا شوند)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('مدت زمان به ساعت')
        .setMinValue(1)
        .setMaxValue(168))
    .addBooleanOption(option =>
      option.setName('anonymous')
        .setDescription('حالت ناشناس')
        .setRequired(false))
];

async function registerCommands() {
  try {
    const rest = new REST({ version: '10' }).setToken(config.token);
    await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
    console.log('✅ دستورات با موفقیت ثبت شدند');
  } catch (error) {
    console.error('❌ خطا در ثبت دستورات:', error);
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
          
          const updatedEmbed = new EmbedBuilder(embed.data)
            .spliceFields(2, 1, { 
              name: `${EMOJIS.TIME_REMAINING} زمان باقیمانده`,
              value: `<t:${Math.floor(poll.endTime / 1000)}:R>`,
              inline: true 
            });
          
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
    const maxVotes = Math.max(...results.map(r => r.count), 1);

    const embed = new EmbedBuilder()
      .setColor(COLORS.ERROR)
      .setTitle(`${EMOJIS.TOTAL_VOTES} نتایج نظرسنجی`)
      .addFields(
        { name: `${EMOJIS.QUESTION} سوال`, value: poll.question, inline: false },
        { name: `${EMOJIS.OPTIONS} نتایج`, value: results.map((r, i) => {
          const percentage = totalVotes > 0 ? (r.count / totalVotes) * 100 : 0;
          const barLength = Math.round((r.count / maxVotes) * 15);
          const bar = '■'.repeat(barLength) + '□'.repeat(15 - barLength);
          return `${reactionEmojis[i]} ${r.option}\n${bar} **${r.count}** رأی (${percentage.toFixed(1)}%)`;
        }).join('\n\n'), inline: false }
      )
      .setFooter({ 
        text: poll.anonymous ? '🔒 نظرسنجی ناشناس | پایان یافته' : `${poll.creatorName} ایجاد شده توسط | پایان یافته`,
        iconURL: client.user.displayAvatarURL()
      })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
    config.activePolls.delete(messageId);
    await saveSettings();
  } catch (error) {
    console.error('Error in endPoll:', error);
  }
}

client.once('ready', () => {
  console.log(`✨ ربات با نام ${client.user.tag} آنلاین شد`);
  client.user.setPresence({
    activities: [{ name: '📊 نظرسنجی‌های شما', type: 3 }],
    status: 'online'
  });
  
  initSettings().then(() => {
    registerCommands();
    startPollChecker();
  });
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand() && !interaction.isButton()) return;

  if (interaction.isCommand()) {
    await interaction.deferReply({ ephemeral: true });

    try {
      switch (interaction.commandName) {
        case 'ping':
          const pingEmbed = new EmbedBuilder()
            .setColor(COLORS.PING)
            .setTitle(`${EMOJIS.PING} وضعیت ربات`)
            .setDescription(`🏓 پینگ: **${client.ws.ping}ms**\n✨ وضعیت: **آنلاین**`)
            .setFooter({ 
              text: `درخواست شده توسط ${interaction.user.tag}`,
              iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();
          
          await interaction.editReply({ embeds: [pingEmbed] });
          break;

        case 'setpollchannel':
          config.pollChannel = interaction.channelId;
          if (await saveSettings()) {
            const embed = new EmbedBuilder()
              .setColor(COLORS.SUCCESS)
              .setTitle(`${EMOJIS.SETTINGS} تنظیمات کانال`)
              .setDescription(`کانال نظرسنجی به <#${config.pollChannel}> تغییر یافت`)
              .setFooter({ 
                text: `تنظیم شده توسط ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
              })
              .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
          } else {
            await interaction.editReply({ 
              content: `${EMOJIS.ERROR} خطا در تنظیم کانال`
            });
          }
          break;

        case 'setmoderatorrole':
          config.moderatorRole = interaction.options.getRole('role').id;
          if (await saveSettings()) {
            const embed = new EmbedBuilder()
              .setColor(COLORS.SUCCESS)
              .setTitle(`${EMOJIS.SETTINGS} تنظیمات رول`)
              .setDescription(`رول تأییدکننده به <@&${config.moderatorRole}> تغییر یافت`)
              .setFooter({ 
                text: `تنظیم شده توسط ${interaction.user.tag}`,
                iconURL: interaction.user.displayAvatarURL()
              })
              .setTimestamp();
            
            await interaction.editReply({ embeds: [embed] });
          } else {
            await interaction.editReply({ 
              content: `${EMOJIS.ERROR} خطا در تنظیم رول`
            });
          }
          break;

        case 'createpoll':
          if (!config.pollChannel || !config.moderatorRole) {
            await interaction.editReply({ 
              content: `${EMOJIS.ERROR} لطفاً ابتدا کانال و رول را تنظیم کنید`
            });
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
            anonymous: interaction.options.getBoolean('anonymous') || false,
            voters: new Map()
          };

          if (poll.options.length < 2 || poll.options.length > 5) {
            await interaction.editReply({ 
              content: `${EMOJIS.ERROR} نظرسنجی باید بین ۲ تا ۵ گزینه داشته باشد`
            });
            return;
          }

          config.pendingPolls.set(pollId, poll);

          const embed = new EmbedBuilder()
            .setColor(COLORS.PENDING)
            .setTitle(`${poll.anonymous ? '🔒 ' : ''}📊 نظرسنجی در انتظار تأیید`)
            .setDescription('لطفاً این نظرسنجی را بررسی و تأیید یا رد کنید! 🚨')
            .addFields(
              { name: `${EMOJIS.QUESTION} سوال`, value: poll.question, inline: false },
              { name: `${EMOJIS.OPTIONS} گزینه‌ها`, value: poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
              { name: `${EMOJIS.DURATION} مدت زمان`, value: `${poll.duration / 3600000} ساعت`, inline: true },
              { name: `${EMOJIS.ANONYMOUS} ناشناس`, value: poll.anonymous ? 'بله ✅' : 'خیر ❌', inline: true },
              { name: `${EMOJIS.ID} شناسه`, value: pollId, inline: true }
            )
            .setFooter({ 
              text: poll.anonymous ? 'نظرسنجی ناشناس | در انتظار تأیید' : `${poll.creatorName} ایجاد شده توسط | در انتظار تأیید`,
              iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

          const row = new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(`approve_${pollId}`)
                .setLabel('تأیید')
                .setStyle(ButtonStyle.Success)
                .setEmoji('✅'),
              new ButtonBuilder()
                .setCustomId(`reject_${pollId}`)
                .setLabel('رد')
                .setStyle(ButtonStyle.Danger)
                .setEmoji('❌')
            );

          await interaction.editReply({ 
            content: `${EMOJIS.SUCCESS} نظرسنجی شما ایجاد و در انتظار تأیید است`
          });

          await interaction.channel.send({
            content: `<@&${config.moderatorRole}> یک نظرسنجی جدید نیاز به تأیید دارد!`,
            embeds: [embed],
            components: [row]
          });
          break;
      }
    } catch (error) {
      console.error('Error:', error);
      await interaction.editReply({ 
        content: `${EMOJIS.ERROR} خطایی رخ داد` 
      });
    }
  } else if (interaction.isButton()) {
    if (!interaction.member.roles.cache.has(config.moderatorRole)) {
      await interaction.reply({ 
        content: `${EMOJIS.ERROR} شما دسترسی لازم برای این کار را ندارید`, 
        ephemeral: true 
      });
      return;
    }

    const [action, pollId] = interaction.customId.split('_');
    const poll = config.pendingPolls.get(pollId);
    
    if (!poll) {
      await interaction.update({ 
        content: `${EMOJIS.ERROR} نظرسنجی مورد نظر یافت نشد`, 
        embeds: [], 
        components: [] 
      });
      return;
    }

    if (action === 'approve') {
      const channel = await client.channels.fetch(config.pollChannel);
      const pollEmbed = new EmbedBuilder()
        .setTitle(`${poll.anonymous ? '🔒 ' : ''}📊 نظرسنجی فعال`)
        .setColor(COLORS.ACTIVE)
        .addFields(
          { name: `${EMOJIS.QUESTION} سوال`, value: poll.question, inline: false },
          { name: `${EMOJIS.OPTIONS} گزینه‌ها`, value: poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n'), inline: false },
          { name: `${EMOJIS.TIME_REMAINING} زمان باقیمانده`, value: `<t:${Math.floor(poll.endTime / 1000)}:R>`, inline: true }
        )
        .setFooter({ 
          text: poll.anonymous ? 'نظرسنجی ناشناس | فعال' : `${poll.creatorName} ایجاد شده توسط | فعال`,
          iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();

      const msg = await channel.send({ embeds: [pollEmbed] });
      
      for (const emoji of reactionEmojis.slice(0, poll.options.length)) {
        await msg.react(emoji);
      }

      config.activePolls.set(msg.id, poll);
      config.pendingPolls.delete(pollId);
      await saveSettings();

      const updatedEmbed = new EmbedBuilder()
        .setTitle('✅ نظرسنجی تأیید شد')
        .setColor(COLORS.SUCCESS)
        .setDescription(`این نظرسنجی توسط <@${interaction.user.id}> تأیید و در <#${config.pollChannel}> منتشر شد`)
        .setTimestamp();

      await interaction.update({ 
        content: null,
        embeds: [updatedEmbed],
        components: []
      });
    } else if (action === 'reject') {
      config.pendingPolls.delete(pollId);
      
      const updatedEmbed = new EmbedBuilder()
        .setTitle('❌ نظرسنجی رد شد')
        .setColor(COLORS.ERROR)
        .setDescription(`این نظرسنجی توسط <@${interaction.user.id}> رد شد`)
        .setTimestamp();

      await interaction.update({ 
        content: null,
        embeds: [updatedEmbed],
        components: []
      });
    }
  }
});

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;

  const poll = config.activePolls.get(reaction.message.id);
  if (!poll) return;

  const emoji = reaction.emoji.name;
  if (!reactionEmojis.includes(emoji)) {
    await reaction.users.remove(user);
  }
});

client.login(config.token).catch(console.error);
