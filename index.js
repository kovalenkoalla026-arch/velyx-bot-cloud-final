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
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `https://industrious-creation-production-dddb.up.railway.app/api/auth/callback`;

// --- DATABASE SCHEMAS ---
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
          }
,
          recruitment: {
                        open: { type: Boolean, default: false },
                        title: { type: String, default: 'Recruitment Applications' },
                        description: { type: String, default: 'Click the button below to apply.' },
                        questions: { type: Array, default: [] },
                        approvalRole: { type: String, default: '' },
                        approvalMessage: { type: String, default: '' }
          },
          automod: {
                        antiInvite: { type: Boolean, default: false },
                        antiLink: { type: Boolean, default: false },
                        antiSpam: { type: Boolean, default: false },
                        punishment: { type: String, default: 'none' }
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

// --- APP & CLIENT SETUP ---
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

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI);

app.use(session({
        secret: 'velyx-secret-key-1337',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- AUTH ROUTES ---
app.get('/api/auth/login', (req, res) => {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
        res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.redirect('/');

          try {
                    const params = new URLSearchParams();
                    params.append('client_id', CLIENT_ID);
                    params.append('client_secret', CLIENT_SECRET);
                    params.append('grant_type', 'authorization_code');
                    params.append('code', code);
                    params.append('redirect_uri', REDIRECT_URI);

          const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
                      method: 'POST',
                      body: params,
                      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
                    const tokens = await tokenRes.json();

          const userRes = await fetch('https://discord.com/api/users/@me', {
                      headers: { Authorization: `Bearer ${tokens.access_token}` }
          });
                    const user = await userRes.json();

          req.session.user = user;
                    req.session.accessToken = tokens.access_token;
                    res.redirect('/servers-page');
          } catch (err) {
                    console.error('Auth Error:', err);
                    res.status(500).send('Auth Error');
          }
});

function checkAuth(req, res, next) {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        next();
}

app.get('/api/user', (req, res) => {
        res.json(req.session.user || null);
});

app.get('/api/logout', (req, res) => {
        req.session.destroy();
        res.redirect('/');
});

// --- CORE LOGIC ---
async function getConfig(guildId) {
          let conf = await GuildConfig.findOne({ guildId });
          if (!conf) {
                        conf = new GuildConfig({ guildId });
                        await conf.save();
          }
          return conf;
}

async function saveConfig(guildId, configData) {
          await GuildConfig.findOneAndUpdate({ guildId }, configData, { upsert: true });
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
            if (!guild) return;
            const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
            if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {}
}

// --- DISCORD EVENTS ---
client.on('messageCreate', async (message) => {
          if (message.author?.bot || !message.guild) return;
          await updateStats('global');
          await updateStats(message.guild.id);
});

client.on('messageDelete', async message => {
        if (message.author?.bot || !message.guild) return;
        const embed = new EmbedBuilder().setTitle('Message Deleted').setColor('#ff4757')
          .addFields(
                { name: 'Author', value: `${message.author?.tag || 'Unknown'} (<@${message.author?.id || '?'}>)`, inline: true },
                { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
                { name: 'Content', value: message.content || '*[No text]*' }
                    ).setTimestamp();
        await sendLog(message.guild.id, embed, 'messageDelete', message.channelId);
});

client.on('guildMemberAdd', async member => {
        const embed = new EmbedBuilder().setTitle('New Member').setColor('#2ed573')
          .addFields(
                { name: 'User', value: `${member.user.tag} (<@${member.id}>)` },
                { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` }
                    ).setTimestamp();
        await sendLog(member.guild.id, embed, 'memberJoin');
});

// --- API ROUTES ---
app.get('/api/config/:guildId', checkAuth, async (req, res) => {
          try {
                        const guild = client.guilds.cache.get(req.params.guildId);
                        const config = await getConfig(req.params.guildId);
                        const channels = guild ? Array.from(guild.channels.cache.values())
                                          .filter(c => c.type === 0 || c.type === 5)
                                          .map(c => ({ id: c.id, name: c.name })) : [];
                        res.json({ config, channels, guild: guild ? { name: guild.name, icon: guild.iconURL() } : null });
          } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/config/:guildId', checkAuth, async (req, res) => {
          try {
                        await saveConfig(req.params.guildId, req.body);
                        res.json({ success: true });
          } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analytics', async (req, res) => {
          const guildId = req.query.guildId;
          if (!guildId) return res.status(400).json({ error: 'Missing guildId' });
          try {
                        const guild = client.guilds.cache.get(guildId);
                        const stats = await getStats(guildId);
                        res.json({
                                          totalMembers: guild ? guild.memberCount : 0,
                                          activeUsers: guild ? guild.members.cache.filter(m => m.presence?.status !== 'offline').size : 0,
                                          messagesToday: stats.messagesToday,
                                          chartData: [0, 0, 0, 0, 0, 0, stats.messagesToday]
                        });
          } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- START ---
client.on('ready', () => {
          console.log(`Logged in as ${client.user.tag}`);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
