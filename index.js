
require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { QuickDB } = require('quick.db');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

const db = new QuickDB();
const pendingPolls = new Map();
const activePolls = new Map();
const reactionEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];

client.once('ready', () => {
  console.log(`Bot logged in as ${client.user.tag}`);
  registerCommands();
});

async function registerCommands() {
  const commands = [
    {
      name: 'setpollchannel',
      description: 'Set the channel for polls 📍',
      defaultMemberPermissions: PermissionFlagsBits.ManageChannels
    },
    {
      name: 'setmoderatorrole',
      description: 'Set the poll moderator role 🛡️',
      options: [{
        name: 'role',
        type: 8,
        description: 'The moderator role',
        required: true
      }],
      defaultMemberPermissions: PermissionFlagsBits.ManageRoles
    },
    {
      name: 'createpoll',
      description: 'Create a new poll 📝',
      options: [
        {
          name: 'question',
          type: 3,
          description: 'The poll question',
          required: true
        },
        {
          name: 'options',
          type: 3,
          description: 'Poll options separated by |',
          required: true
        },
        {
          name: 'duration',
          type: 4,
          description: 'Poll duration in hours',
          required: false
        },
        {
          name: 'anonymous',
          type: 5,
          description: 'Make the poll anonymous',
          required: false
        }
      ]
    },
    {
      name: 'approvepoll',
      description: 'Approve a pending poll ✅',
      options: [{
        name: 'pollid',
        type: 3,
        description: 'The poll ID',
        required: true
      }]
    },
    {
      name: 'rejectpoll',
      description: 'Reject a pending poll ❌',
      options: [{
        name: 'pollid',
        type: 3,
        description: 'The poll ID',
        required: true
      }]
    }
  ];

  try {
    await client.application.commands.set(commands);
    console.log('Commands registered');
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'setpollchannel':
        await handleSetPollChannel(interaction);
        break;
      case 'setmoderatorrole':
        await handleSetModeratorRole(interaction);
        break;
      case 'createpoll':
        await handleCreatePoll(interaction);
        break;
      case 'approvepoll':
        await handleApprovePoll(interaction);
        break;
      case 'rejectpoll':
        await handleRejectPoll(interaction);
        break;
    }
  } catch (error) {
    console.error('Command error:', error);
    await interaction.reply({ content: '❌ An error occurred! 🚨', ephemeral: true });
  }
});

async function handleSetPollChannel(interaction) {
  await db.set(`pollChannel_${interaction.guildId}`, interaction.channelId);
  await interaction.reply({ content: '✅ Poll channel set! 🎉', ephemeral: true });
}

async function handleSetModeratorRole(interaction) {
  const role = interaction.options.getRole('role');
  await db.set(`moderatorRole_${interaction.guildId}`, role.id);
  await interaction.reply({ content: `✅ Moderator role set to ${role}! 🎉`, ephemeral: true });
}

async function handleCreatePoll(interaction) {
  const pollChannel = await db.get(`pollChannel_${interaction.guildId}`);
  if (interaction.channelId !== pollChannel) {
    await interaction.reply({ content: '❌ Please use this command in the poll channel!', ephemeral: true });
    return;
  }

  const question = interaction.options.getString('question');
  const options = interaction.options.getString('options').split('|').map(opt => opt.trim());
  const duration = interaction.options.getInteger('duration') || 24;
  const anonymous = interaction.options.getBoolean('anonymous') || false;

  if (options.length < 2 || options.length > 5) {
    await interaction.reply({ content: '❌ Please provide 2-5 options!', ephemeral: true });
    return;
  }

  const pollId = Date.now().toString();
  const poll = {
    id: pollId,
    question,
    options,
    duration,
    anonymous,
    author: interaction.user.id
  };

  pendingPolls.set(pollId, poll);

  const embed = new EmbedBuilder()
    .setTitle('📊 Pending Poll')
    .setColor(0xFFFF00)
    .setDescription(`**Question:** ${question}\n\n**Options:**\n${options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}\n\n**Duration:** ${duration} hours\n**Anonymous:** ${anonymous}\n**Poll ID:** ${pollId}`)
    .setFooter({ text: 'Waiting for moderator approval ⏳' })
    .setTimestamp();

  const moderatorRole = await db.get(`moderatorRole_${interaction.guildId}`);
  await interaction.reply({ content: `<@&${moderatorRole}> A new poll is waiting for approval! 🚨`, embeds: [embed] });
}

async function handleApprovePoll(interaction) {
  const moderatorRole = await db.get(`moderatorRole_${interaction.guildId}`);
  if (!interaction.member.roles.cache.has(moderatorRole)) {
    await interaction.reply({ content: '❌ You need the moderator role!', ephemeral: true });
    return;
  }

  const pollId = interaction.options.getString('pollid');
  const poll = pendingPolls.get(pollId);
  if (!poll) {
    await interaction.reply({ content: '❌ Poll not found!', ephemeral: true });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle('📊 New Poll')
    .setColor(0x00FF00)
    .setDescription(`**Question:** ${poll.question}\n\n**Options:**\n${poll.options.map((opt, i) => `${reactionEmojis[i]} ${opt}`).join('\n')}`)
    .setFooter({ text: poll.anonymous ? 'Anonymous Poll' : `Created by ${interaction.guild.members.cache.get(poll.author).displayName}` })
    .setTimestamp();

  const pollMessage = await interaction.channel.send({ embeds: [embed] });
  
  for (let i = 0; i < poll.options.length; i++) {
    await pollMessage.react(reactionEmojis[i]);
  }

  pendingPolls.delete(pollId);
  activePolls.set(pollId, { ...poll, messageId: pollMessage.id });

  setTimeout(async () => {
    const message = await interaction.channel.messages.fetch(pollMessage.id);
    const results = poll.options.map((opt, i) => {
      const reaction = message.reactions.cache.get(reactionEmojis[i]);
      return `${opt}: ${reaction ? reaction.count - 1 : 0} votes`;
    });

    const resultsEmbed = new EmbedBuilder()
      .setTitle('📊 Poll Results')
      .setColor(0xFF0000)
      .setDescription(`**Question:** ${poll.question}\n\n**Results:**\n${results.join('\n')}`)
      .setFooter({ text: 'Poll ended! 🎉' })
      .setTimestamp();

    await interaction.channel.send({ embeds: [resultsEmbed] });
    activePolls.delete(pollId);
  }, poll.duration * 3600000);

  await interaction.reply({ content: '✅ Poll approved and published! 🎉', ephemeral: true });
}

async function handleRejectPoll(interaction) {
  const moderatorRole = await db.get(`moderatorRole_${interaction.guildId}`);
  if (!interaction.member.roles.cache.has(moderatorRole)) {
    await interaction.reply({ content: '❌ You need the moderator role!', ephemeral: true });
    return;
  }

  const pollId = interaction.options.getString('pollid');
  if (pendingPolls.delete(pollId)) {
    await interaction.reply({ content: '❌ Poll rejected! 🚫', ephemeral: true });
  } else {
    await interaction.reply({ content: '❌ Poll not found!', ephemeral: true });
  }
}

client.login(process.env.TOKEN);
