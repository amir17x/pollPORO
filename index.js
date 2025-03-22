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
    .setDescription('Set poll channel')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),
  new SlashCommandBuilder()
    .setName('setmoderatorrole')
    .setDescription('Set moderator role')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addRoleOption(option =>
      option.setName('role')
        .setDescription('Select moderator role')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('createpoll')
    .setDescription('Create a new poll')
    .addStringOption(option =>
      option.setName('question')
        .setDescription('Poll question')
        .setRequired(true)
        .setMaxLength(256))
    .addStringOption(option =>
      option.setName('options')
        .setDescription('Options separated by |')
        .setRequired(true))
    .addIntegerOption(option =>
      option.setName('duration')
        .setDescription('Poll duration in hours')
        .setMinValue(1)
        .setMaxValue(168)),
  new SlashCommandBuilder()
    .setName('approvepoll')
    .setDescription('Approve a pending poll')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('Poll ID')
        .setRequired(true)),
  new SlashCommandBuilder()
    .setName('rejectpoll')
    .setDescription('Reject a pending poll')
    .addStringOption(option =>
      option.setName('pollid')
        .setDescription('Poll ID')
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
      if (Date.now() >= poll.endTime) {
        try {
          await endPoll(messageId);
        } catch (error) {
          console.error('Error ending poll:', error);
        }
      }
    }
  }, 60000);
}

async function endPoll(messageId) {
  const poll = config.activePolls.get(messageId);
  if (!poll) return;

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
    .setTitle('Poll Results')
    .setDescription(
      `Question: ${poll.question}\n\n` +
      results.map((r, i) => `${reactionEmojis[i]} ${r.option}: ${r.count} votes (${totalVotes > 0 ? ((r.count/totalVotes)*100).toFixed(1) : 0}%)`).join('\n') +
      `\n\nTotal votes: ${totalVotes}`
    )
    .setTimestamp();

  await channel.send({ embeds: [embed] });
  config.activePolls.delete(messageId);
  await saveSettings();
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
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
          await interaction.reply({ content: 'Poll channel set', ephemeral: true });
        }
        break;

      case 'setmoderatorrole':
        config.moderatorRole = interaction.options.getRole('role').id;
        if (await saveSettings()) {
          await interaction.reply({ content: 'Moderator role set', ephemeral: true });
        }
        break;

      case 'createpoll':
        if (!config.pollChannel || !config.moderatorRole) {
          await interaction.reply({ content: 'Please set up poll channel and moderator role first', ephemeral: true });
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
          await interaction.reply({ content: 'Poll must have 2-5 options', ephemeral: true });
          return;
        }

        config.pendingPolls.set(pollId, poll);

        const embed = new EmbedBuilder()
          .setTitle('Pending Poll')
          .setDescription(
            `Question: ${poll.question}\n\n` +
            poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')
          )
          .setFooter({ text: `Poll ID: ${pollId}` });

        await interaction.reply({ embeds: [embed] });
        break;

      case 'approvepoll':
        const pollToApprove = config.pendingPolls.get(interaction.options.getString('pollid'));
        if (!pollToApprove) {
          await interaction.reply({ content: 'Poll not found', ephemeral: true });
          return;
        }

        const channel = await client.channels.fetch(config.pollChannel);
        const pollEmbed = new EmbedBuilder()
          .setTitle('Active Poll')
          .setDescription(
            `Question: ${pollToApprove.question}\n\n` +
            pollToApprove.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')
          );

        const msg = await channel.send({ embeds: [pollEmbed] });
        for (const emoji of reactionEmojis.slice(0, pollToApprove.options.length)) {
          await msg.react(emoji);
        }

        config.activePolls.set(msg.id, pollToApprove);
        config.pendingPolls.delete(interaction.options.getString('pollid'));
        await saveSettings();

        await interaction.reply({ content: 'Poll approved', ephemeral: true });
        break;

      case 'rejectpoll':
        config.pendingPolls.delete(interaction.options.getString('pollid'));
        await interaction.reply({ content: 'Poll rejected', ephemeral: true });
        break;
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.reply({ content: 'An error occurred', ephemeral: true }).catch(console.error);
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