const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, PermissionsBitField, REST, Routes } = require('discord.js');
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

async function init() {
  try {
    const settings = await db.get('settings') || {};
    config.pollChannel = settings.pollChannel || null;
    config.moderatorRole = settings.moderatorRole || null;
    config.activePolls = new Map(settings.activePolls || []);
    console.log('Settings loaded successfully ✅');
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
    .setDescription('Set poll channel 📍')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
  
  new SlashCommandBuilder()
    .setName('setmoderatorrole')
    .setDescription('Set moderator role 🛡️')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Select moderator role')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('Create a new poll 📝')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Poll question')
        .setRequired(true)
        .setMaxLength(256))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('Options separated by | (e.g: Yes | No)')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Poll duration in hours (default: 24)')
        .setMinValue(1)
        .setMaxValue(168))
    .addBooleanOption(option =>
      option.setName('anonymous')
        .setDescription('Anonymous poll? (default: false)')),
  
  new SlashCommandBuilder()
    .setName('approvepoll')
    .setDescription('Approve a pending poll ✅')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('Enter poll ID')
        .setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('rejectpoll')
    .setDescription('Reject a pending poll ❌')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('Enter poll ID')
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
  console.log(`🚀 Logged in as ${client.user.tag}`);
  init().then(() => {
    registerCommands();
    checkActivePolls();
  });
});

async function checkActivePolls() {
  for (const [messageId, poll] of config.activePolls.entries()) {
    if (!poll.endTime) continue;
    
    const timeLeft = poll.endTime - Date.now();
    if (timeLeft <= 0) {
      try {
        await endPoll(messageId);
      } catch (error) {
        console.error('Error ending poll:', error);
      }
    } else {
      setTimeout(() => endPoll(messageId), timeLeft);
    }
  }
}

async function endPoll(messageId) {
  const poll = config.activePolls.get(messageId);
  if (!poll) return;

  try {
    const channel = await client.channels.fetch(config.pollChannel);
    if (!channel) throw new Error('Channel not found');

    const message = await channel.messages.fetch(messageId);
    const reactions = message.reactions.cache;
    
    const results = poll.options.map((opt, i) => {
      const reaction = reactions.get(reactionEmojis[i]);
      const count = reaction ? reaction.count - 1 : 0;
      return { option: opt, count };
    });

    const totalVotes = results.reduce((sum, result) => sum + result.count, 0);
    
    const resultEmbed = new EmbedBuilder()
      .setColor(0xFF0000)
      .setTitle('📊 Poll Results')
      .setDescription(`**Question:** ${poll.question}\n\n**Results:**\n${results.map((res, i) => {
        const percentage = totalVotes > 0 ? ((res.count / totalVotes) * 100).toFixed(1) : 0;
        return `${reactionEmojis[i]} ${res.option}: ${res.count} votes (${percentage}%)`;
      }).join('\n')}\n\n**Total votes:** ${totalVotes}`)
      .setFooter({ text: 'Poll ended! 🎉' })
      .setTimestamp();

    await channel.send({ embeds: [resultEmbed] });
    config.activePolls.delete(messageId);
    await saveSettings();
  } catch (error) {
    console.error('Error ending poll:', error);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'setpollchannel': {
        const channel = interaction.channel;
        if (!channel.isTextBased()) {
          return interaction.reply({ content: '❌ Invalid channel type! Must be a text channel.', ephemeral: true });
        }

        config.pollChannel = channel.id;
        const saved = await saveSettings();
        
        if (!saved) {
          return interaction.reply({ content: '❌ Failed to save settings! Please try again.', ephemeral: true });
        }

        await interaction.reply({ content: '✅ Poll channel set successfully!', ephemeral: true });
        break;
      }

      case 'setmoderatorrole': {
        const role = interaction.options.getRole('role');
        config.moderatorRole = role.id;
        const saved = await saveSettings();

        if (!saved) {
          return interaction.reply({ content: '❌ Failed to save settings! Please try again.', ephemeral: true });
        }

        await interaction.reply({ content: `✅ Moderator role set to ${role.name}!`, ephemeral: true });
        break;
      }

      case 'createpoll': {
        if (!config.pollChannel || !config.moderatorRole) {
          return interaction.reply({ content: '❌ Please set up poll channel and moderator role first!', ephemeral: true });
        }

        const question = interaction.options.getString('question');
        const optionsStr = interaction.options.getString('options');
        const duration = interaction.options.getInteger('duration') || 24;
        const anonymous = interaction.options.getBoolean('anonymous') || false;

        const options = optionsStr.split('|').map(opt => opt.trim()).filter(Boolean);
        
        if (options.length < 2 || options.length > 5) {
          return interaction.reply({ content: '❌ Poll must have 2-5 options!', ephemeral: true });
        }

        const pollId = Date.now().toString();
        const endTime = Date.now() + (duration * 60 * 60 * 1000);

        const pollData = {
          question,
          options,
          duration: duration * 60 * 60 * 1000,
          endTime,
          anonymous,
          creator: interaction.user.id,
          votes: new Array(options.length).fill(0),
          voters: new Set()
        };

        config.pendingPolls.set(pollId, pollData);

        const embed = new EmbedBuilder()
          .setColor(0xFFFF00)
          .setTitle('📊 Pending Poll')
          .setDescription(
            `**Question:** ${question}\n` +
            `**Options:**\n${options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}\n` +
            `**Duration:** ${duration}h\n` +
            `**Anonymous:** ${anonymous ? 'Yes' : 'No'}\n` +
            `**Poll ID:** ${pollId}`
          )
          .setFooter({ text: 'Awaiting moderator approval ⏳' })
          .setTimestamp();

        await interaction.reply({ 
          content: `<@&${config.moderatorRole}> New poll awaiting approval!`,
          embeds: [embed]
        });
        break;
      }

      case 'approvepoll': {
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          return interaction.reply({ content: '❌ You need moderator role to approve polls!', ephemeral: true });
        }

        const pollId = interaction.options.getString('pollid');
        const pollData = config.pendingPolls.get(pollId);

        if (!pollData) {
          return interaction.reply({ content: '❌ Poll not found!', ephemeral: true });
        }

        const channel = await client.channels.fetch(config.pollChannel);
        if (!channel) {
          return interaction.reply({ content: '❌ Poll channel not found!', ephemeral: true });
        }

        const embed = new EmbedBuilder()
          .setColor(0x00FF00)
          .setTitle('📊 Active Poll')
          .setDescription(
            `**Question:** ${pollData.question}\n\n` +
            `${pollData.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}\n\n` +
            `**Ends:** <t:${Math.floor(pollData.endTime / 1000)}:R>`
          )
          .setFooter({ text: pollData.anonymous ? 'Anonymous Poll' : `Created by ${interaction.guild.members.cache.get(pollData.creator)?.displayName || 'Unknown'}` })
          .setTimestamp();

        const message = await channel.send({ embeds: [embed] });

        for (const emoji of reactionEmojis.slice(0, pollData.options.length)) {
          await message.react(emoji);
        }

        config.activePolls.set(message.id, { ...pollData, messageId: message.id });
        config.pendingPolls.delete(pollId);
        await saveSettings();

        setTimeout(() => endPoll(message.id), pollData.duration);

        await interaction.reply({ content: '✅ Poll approved and published!', ephemeral: true });
        break;
      }

      case 'rejectpoll': {
        if (!interaction.member.roles.cache.has(config.moderatorRole)) {
          return interaction.reply({ content: '❌ You need moderator role to reject polls!', ephemeral: true });
        }

        const pollId = interaction.options.getString('pollid');
        if (!config.pendingPolls.has(pollId)) {
          return interaction.reply({ content: '❌ Poll not found!', ephemeral: true });
        }

        config.pendingPolls.delete(pollId);
        await interaction.reply({ content: '❌ Poll rejected!', ephemeral: true });
        break;
      }
    }
  } catch (error) {
    console.error('Command error:', error);
    try {
      const response = '❌ An error occurred! Please try again.';
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
  await saveSettings();
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
    await saveSettings();
  }
});

process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.login(config.token).catch(console.error);