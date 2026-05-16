require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    EmbedBuilder,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const MongoStore = require('connect-mongo');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:' + PORT + '/api/auth/callback';

// --- DATABASE SETUP ---
const guildConfigSchema = new mongoose.Schema({
      guildId: { type: String, required: true, unique: true },
      logChannelId: { type: String, default: '' },
      adminChannelId: { type: String, default: '' },
      logging: {
                channels: {
                              joins: { type: String, default: '' },
                              server: { type: String, default: '' },
                              voice: { type: String, default: '' },
                              messages: { type: String, default: '' },
                              leaves: { type: String, default: '' }
                },
                events: {
                              channelCreate: { type: Boolean, default: false },
                              channelUpdate: { type: Boolean, default: false },
                              channelDelete: { type: Boolean, default: false },
                              roleCreate: { type: Boolean, default: false },
                              roleUpdate: { type: Boolean, default: false },
                              roleDelete: { type: Boolean, default: false },
                              guildUpdate: { type: Boolean, default: false },
                              emojiUpdate: { type: Boolean, default: false },
                              memberRoleUpdate: { type: Boolean, default: false },
                              memberNameUpdate: { type: Boolean, default: false },
                              memberAvatarUpdate: { type: Boolean, default: false },
                              memberBan: { type: Boolean, default: false },
                              memberUnban: { type: Boolean, default: false },
                              memberTimeout: { type: Boolean, default: false },
                              memberTimeoutRemove: { type: Boolean, default: false },
                              memberJoin: { type: Boolean, default: false },
                              memberLeave: { type: Boolean, default: false },
                              voiceJoin: { type: Boolean, default: false },
                              voiceMove: { type: Boolean, default: false },
                              voiceLeave: { type: Boolean, default: false },
                              messageDelete: { type: Boolean, default: false },
                              messageEdit: { type: Boolean, default: false },
                              messageBulkDelete: { type: Boolean, default: false }
                },
                ignoredChannels: { type: [String], default: [] }
      },
      recruitment: {
                open: { type: Boolean, default: false },
                title: { type: String, default: '\uD83D\uDCE9 \u041F\u043E\u0434\u0430\u0447\u0430 \u0437\u0430\u044F\u0432\u043E\u043A' },
                description: { type: String, default: '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0443 \u043D\u0438\u0436\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0434\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443.' },
                questions: { type: Array, default: [] },
                approvalRole: { type: String, default: '' },
                approvalMessage: { type: String, default: '' }
      },
      automod: {
                antiInvite: { type: Boolean, default: false },
                antiLink: { type: Boolean, default: false },
                antiSpam: { type: Boolean, default: false },
                punishment: { type: String, default: 'none' }
      },
      activePanels: { type: Map, of: Object, default: {} },
      liveStats: {
                channelId: { type: String },
                messageId: { type: String }
      }
});
const statsSchema = new mongoose.Schema({
      id: { type: String, required: true, unique: true },
      messagesToday: { type: Number, default: 0 },
      lastResetDate: { type: String, default: new Date().toDateString() }
});

const applicationSchema = new mongoose.Schema({
      guildId: String,
      userId: String,
      userTag: String,
      userAvatar: String,
      panelId: String,
      panelTitle: String,
      answers: Array,
      status: { type: String, default: 'pending' },
      rejectionReason: String,
      createdAt: { type: Date, default: Date.now }
});

const recruitmentPanelSchema = new mongoose.Schema({
      guildId: String,
      channelId: String,
      messageId: String,
      title: String,
      status: { type: String, default: 'open' },
      createdAt: { type: Date, default: Date.now }
});

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Application = mongoose.model('Application', applicationSchema);
const RecruitmentPanel = mongoose.model('RecruitmentPanel', recruitmentPanelSchema);

const app = express();
const client = new Client({
    intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.GuildPresences,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildModeration,
          GatewayIntentBits.GuildInvites
        ]
});

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

async function getConfig(guildId) {
      let conf = await GuildConfig.findOne({ guildId });
      if (!conf) {
                conf = new GuildConfig({ guildId });
                await conf.save();
      }
      return conf;
}

async function saveConfig(guildId, config) {
      await GuildConfig.findOneAndUpdate({ guildId }, config, { upsert: true });
}

async function getStats(guildId) {
      let stats = await Stats.findOne({ id: guildId });
      if (!stats) {
                stats = new Stats({ id: guildId });
                await stats.save();
      }
      return stats;
}

async function updateStats(guildId, count = 1) {
      const stats = await getStats(guildId);
      const today = new Date().toDateString();
      if (stats.lastResetDate !== today) {
                stats.messagesToday = 0;
                stats.lastResetDate = today;
      }
      stats.messagesToday += count;
      await stats.save();
      return stats;
}

async function sendLog(guildId, embed, type, sourceChannelId = null) {
    const config = await getConfig(guildId);
    if (!config || !config.logging) return;
    if (sourceChannelId && config.logging.ignoredChannels?.includes(sourceChannelId)) return;

  const categoryMap = {
        channelCreate: 'server', channelUpdate: 'server', channelDelete: 'server',
        roleCreate: 'server', roleUpdate: 'server', roleDelete: 'server',
        guildUpdate: 'server', emojiUpdate: 'server',
        memberRoleUpdate: 'members', memberNameUpdate: 'members', memberAvatarUpdate: 'members',
        memberBan: 'members', memberUnban: 'members', memberTimeout: 'members',
        memberJoin: 'joins', memberLeave: 'leaves',
        voiceJoin: 'voice', voiceMove: 'voice', voiceLeave: 'voice',
        messageDelete: 'messages', messageEdit: 'messages'
  };

  const category = categoryMap[type] || 'default';
    const isEnabled = config.logging.events?.[type];
    if (!isEnabled) return;

  const targetChannelId = config.logging.channels?.[category] || config.logChannelId;
    if (!targetChannelId || targetChannelId === 'disabled') return;

  try {
        const guild = client.guilds.cache.get(guildId);
        const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
        if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {}
}

client.on('messageCreate', async (message) => {
      if (message.author?.bot || !message.guild) return;
      await updateStats('global');
      await updateStats(message.guild.id);
});

client.on('messageDelete', async message => {
    if (message.author?.bot || !message.guild) return;
    const embed = new EmbedBuilder().setTitle('\uD83D\uDDD1 \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E').setColor('#ff4757')
      .addFields(
        { name: '\u0410\u0432\u0442\u043E\u0440', value: (message.author?.tag || '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E') + ' (<@' + (message.author?.id || '?') + '>)', inline: true },
        { name: '\u041A\u0430\u043D\u0430\u043B', value: '<#' + message.channelId + '>', inline: true },
        { name: '\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435', value: message.content || '*[\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430]*' }
            ).setTimestamp();
    await sendLog(message.guild.id, embed, 'messageDelete', message.channelId);
});

client.on('guildMemberAdd', async member => {
    const embed = new EmbedBuilder().setTitle('\uD83D\uDCE5 \u041D\u043E\u0432\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A').setColor('#2ed573')
      .addFields(
        { name: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C', value: member.user.tag + ' (<@' + member.id + '>)' },
        { name: '\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0441\u043E\u0437\u0434\u0430\u043D', value: '<t:' + Math.floor(member.user.createdTimestamp / 1000) + ':R>' }
            ).setTimestamp();
    await sendLog(member.guild.id, embed, 'memberJoin');
});

app.get('/api/config/:guildId', async (req, res) => {
      try {
                const guild = client.guilds.cache.get(req.params.guildId);
                const config = await getConfig(req.params.guildId);
                const channels = guild ? Array.from(guild.channels.cache.values())
                              .filter(c => c.type === 0 || c.type === 5)
                              .map(c => ({ id: c.id, name: c.name })) : [];
                res.json({ config, channels, guild: guild ? { name: guild.name, icon: guild.iconURL() } : null });
      } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/:guildId', async (req, res) => {
      try {
                await saveConfig(req.params.guildId, req.body);
                res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
});

client.on('ready', () => {
      console.log('Logged in as ' + client.user.tag);
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
client.login(process.env.DISCORD_TOKEN);
