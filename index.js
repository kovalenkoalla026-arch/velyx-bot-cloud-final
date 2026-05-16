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
        channels: { joins: { type: String, default: '' }, server: { type: String, default: '' }, voice: { type: String, default: '' }, messages: { type: String, default: '' }, leaves: { type: String, default: '' } },
        events: { channelCreate: { type: Boolean, default: false }, channelUpdate: { type: Boolean, default: false }, channelDelete: { type: Boolean, default: false }, roleCreate: { type: Boolean, default: false }, roleUpdate: { type: Boolean, default: false }, roleDelete: { type: Boolean, default: false }, guildUpdate: { type: Boolean, default: false }, emojiUpdate: { type: Boolean, default: false }, memberRoleUpdate: { type: Boolean, default: false }, memberNameUpdate: { type: Boolean, default: false }, memberAvatarUpdate: { type: Boolean, default: false }, memberBan: { type: Boolean, default: false }, memberUnban: { type: Boolean, default: false }, memberTimeout: { type: Boolean, default: false }, memberTimeoutRemove: { type: Boolean, default: false }, memberJoin: { type: Boolean, default: false }, memberLeave: { type: Boolean, default: false }, voiceJoin: { type: Boolean, default: false }, voiceMove: { type: Boolean, default: false }, voiceLeave: { type: Boolean, default: false }, messageDelete: { type: Boolean, default: false }, messageEdit: { type: Boolean, default: false }, messageBulkDelete: { type: Boolean, default: false } },
        ignoredChannels: { type: [String], default: [] }
    },
    recruitment: { open: { type: Boolean, default: false }, title: { type: String, default: '\uD83D\uDCE9 \u041F\u043E\u0434\u0430\u0447\u0430 \u0437\u0430\u044F\u0432\u043E\u043A' }, description: { type: String, default: '\u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0443 \u043D\u0438\u0436\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u0434\u0430\u0442\u044C \u0437\u0430\u044F\u0432\u043A\u0443.' }, questions: { type: Array, default: [] }, approvalRole: { type: String, default: '' }, approvalMessage: { type: String, default: '' } },
    automod: { antiInvite: { type: Boolean, default: false }, antiLink: { type: Boolean, default: false }, antiSpam: { type: Boolean, default: false }, punishment: { type: String, default: 'none' } }
});

const statsSchema = new mongoose.Schema({ id: { type: String, required: true, unique: true }, messagesToday: { type: Number, default: 0 }, lastResetDate: { type: String, default: new Date().toDateString() } });
const applicationSchema = new mongoose.Schema({ guildId: String, userId: String, userTag: String, userAvatar: String, panelId: String, panelTitle: String, answers: Array, status: { type: String, default: 'pending' }, rejectionReason: String, createdAt: { type: Date, default: Date.now } });
const recruitmentPanelSchema = new mongoose.Schema({ guildId: String, channelId: String, messageId: String, title: String, status: { type: String, default: 'open' }, createdAt: { type: Date, default: Date.now } });

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);
const Stats = mongoose.model('Stats', statsSchema);
const Application = mongoose.model('Application', applicationSchema);
const RecruitmentPanel = mongoose.model('RecruitmentPanel', recruitmentPanelSchema);

// --- APP & CLIENT SETUP ---
const app = express();
const client = new Client({ intents: [ GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites ] });

mongoose.connect(process.env.MONGO_URI).catch(err => console.error("⚠️ Ошибка подключения к MongoDB (проверьте ссылку в переменных!):", err.message));

app.use(session({ secret: 'velyx-secret-key-1337', resave: false, saveUninitialized: false, store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }) }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// FRONTEND ROUTES
app.get('/servers-page', (req, res) => res.sendFile(path.join(__dirname, 'public', 'servers.html')));
app.get('/panel', (req, res) => res.sendFile(path.join(__dirname, 'public', 'panel-ultra-final.html')));

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
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', { method: 'POST', body: params, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const tokens = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    req.session.user = await userRes.json();
    req.session.accessToken = tokens.access_token;
    res.redirect('/servers-page');
  } catch (err) { res.status(500).send('Auth Error'); }
});

app.get('/api/auth/me', async (req, res) => {
  if (!req.session.accessToken) return res.status(401).send('Unauthorized');
  try {
    const userRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.accessToken}` } });
    const guilds = await userRes.json();
    const adminGuilds = Array.isArray(guilds) ? guilds.filter(g => (g.permissions & 0x8) === 0x8) : [];
    const mapped = adminGuilds.map(g => ({
        id: g.id, name: g.name, icon: g.icon, botInServer: client.guilds.cache.has(g.id)
    }));
    res.json({ user: req.session.user, clientId: CLIENT_ID, servers: mapped });
  } catch (err) { res.status(500).json({error: err.message}); }
});

function checkAuth(req, res, next) { if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' }); next(); }
app.get('/api/user', (req, res) => { res.json(req.session.user || null); });
app.get('/api/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// --- CORE LOGIC ---
async function getConfig(guildId) { let conf = await GuildConfig.findOne({ guildId }); if (!conf) { conf = new GuildConfig({ guildId }); await conf.save(); } return conf; }
async function saveConfig(guildId, configData) { await GuildConfig.findOneAndUpdate({ guildId }, configData, { upsert: true }); }
async function getStats(guildId) { let stats = await Stats.findOne({ id: guildId }); if (!stats) { stats = new Stats({ id: guildId }); await stats.save(); } return stats; }
async function updateStats(guildId, count = 1) { const stats = await getStats(guildId); const today = new Date().toDateString(); if (stats.lastResetDate !== today) { stats.messagesToday = 0; stats.lastResetDate = today; } stats.messagesToday += count; await stats.save(); return stats; }

async function sendLog(guildId, embed, type, sourceChannelId = null) {
  const config = await getConfig(guildId);
  if (!config || !config.logging) return;
  if (sourceChannelId && config.logging.ignoredChannels?.includes(sourceChannelId)) return;
  const categoryMap = { channelCreate: 'server', channelUpdate: 'server', channelDelete: 'server', roleCreate: 'server', roleUpdate: 'server', roleDelete: 'server', guildUpdate: 'server', emojiUpdate: 'server', memberRoleUpdate: 'members', memberNameUpdate: 'members', memberAvatarUpdate: 'members', memberBan: 'members', memberUnban: 'members', memberTimeout: 'members', memberJoin: 'joins', memberLeave: 'leaves', voiceJoin: 'voice', voiceMove: 'voice', voiceLeave: 'voice', messageDelete: 'messages', messageEdit: 'messages' };
  const category = categoryMap[type] || 'default';
  if (!config.logging.events?.[type]) return;
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
client.on('messageCreate', async (message) => { if (message.author?.bot || !message.guild) return; await updateStats('global'); await updateStats(message.guild.id); });
client.on('messageDelete', async message => { if (message.author?.bot || !message.guild) return; const embed = new EmbedBuilder().setTitle('\uD83D\uDDD1 \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0443\u0434\u0430\u043B\u0435\u043D\u043E').setColor('#ff4757').addFields({ name: '\u0410\u0432\u0442\u043E\u0440', value: `${message.author?.tag || '\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E'} (<@${message.author?.id || '?'}>)`, inline: true }, { name: '\u041A\u0430\u043D\u0430\u043B', value: `<#${message.channelId}>`, inline: true }, { name: '\u0421\u043E\u0434\u0435\u0440\u0436\u0438\u043C\u043E\u0435', value: message.content || '*[\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430]*' }).setTimestamp(); await sendLog(message.guild.id, embed, 'messageDelete', message.channelId); });
client.on('guildMemberAdd', async member => { const embed = new EmbedBuilder().setTitle('\uD83D\uDCE5 \u041D\u043E\u0432\u044B\u0439 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A').setColor('#2ed573').addFields({ name: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C', value: `${member.user.tag} (<@${member.id}>)` }, { name: '\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u0441\u043E\u0437\u0434\u0430\u043D', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` }).setTimestamp(); await sendLog(member.guild.id, embed, 'memberJoin'); });

client.on('guildMemberRemove', async member => {
  const embed = new EmbedBuilder().setTitle('\uD83D\uDCE4 \u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A \u043F\u043E\u043A\u0438\u043D\u0443\u043B \u0441\u0435\u0440\u0432\u0435\u0440').setColor('#ff4757').addFields({ name: '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C', value: `${member.user.tag} (<@${member.id}>)` }).setTimestamp();
  await sendLog(member.guild.id, embed, 'memberLeave');
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
  const embed = new EmbedBuilder().setTitle('\u270F\uFE0F \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u043E').setColor('#feca57').addFields({ name: '\u0410\u0432\u0442\u043E\u0440', value: `${oldMessage.author.tag} (<@${oldMessage.author.id}>)`, inline: true }, { name: '\u041A\u0430\u043D\u0430\u043B', value: `<#${oldMessage.channelId}>`, inline: true }, { name: '\u0421\u0442\u0430\u0440\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435', value: oldMessage.content || '*[\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430]*' }, { name: '\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435', value: newMessage.content || '*[\u0411\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430]*' }).setTimestamp();
  await sendLog(oldMessage.guild.id, embed, 'messageEdit', oldMessage.channelId);
});

client.on('channelCreate', async channel => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder().setTitle('\uD83D\uDCC1 \u041A\u0430\u043D\u0430\u043B \u0441\u043E\u0437\u0434\u0430\u043D').setColor('#2ed573').addFields({ name: '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', value: channel.name }, { name: '\u0422\u0438\u043F', value: channel.type.toString() }).setTimestamp();
  await sendLog(channel.guild.id, embed, 'channelCreate');
});

client.on('channelDelete', async channel => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder().setTitle('\uD83D\uDDD1\uFE0F \u041A\u0430\u043D\u0430\u043B \u0443\u0434\u0430\u043B\u0435\u043D').setColor('#ff4757').addFields({ name: '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', value: channel.name }).setTimestamp();
  await sendLog(channel.guild.id, embed, 'channelDelete');
});

client.on('roleCreate', async role => {
  const embed = new EmbedBuilder().setTitle('\uD83D\uDEE1\uFE0F \u0420\u043E\u043B\u044C \u0441\u043E\u0437\u0434\u0430\u043D\u0430').setColor('#2ed573').addFields({ name: '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', value: role.name }).setTimestamp();
  await sendLog(role.guild.id, embed, 'roleCreate');
});

client.on('roleDelete', async role => {
  const embed = new EmbedBuilder().setTitle('\uD83D\uDEE1\uFE0F \u0420\u043E\u043B\u044C \u0443\u0434\u0430\u043B\u0435\u043D\u0430').setColor('#ff4757').addFields({ name: '\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435', value: role.name }).setTimestamp();
  await sendLog(role.guild.id, embed, 'roleDelete');
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton()) {
        const config = await getConfig(interaction.guildId);
        if (!config || !config.recruitment || !config.recruitment.open) return interaction.reply({ content: '\u274C \u041F\u0440\u0438\u0435\u043C \u0437\u0430\u044F\u0432\u043E\u043A \u0441\u0435\u0439\u0447\u0430\u0441 \u0437\u0430\u043A\u0440\u044B\u0442.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId('apply_modal').setTitle(config.recruitment.title || '\u041F\u043E\u0434\u0430\u0447\u0430 \u0437\u0430\u044F\u0432\u043A\u0438');
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q1').setLabel('\u041A\u0430\u043A \u0432\u0430\u0441 \u0437\u043E\u0432\u0443\u0442?').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q2').setLabel('\u0421\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u0430\u043C \u043B\u0435\u0442?').setStyle(TextInputStyle.Short).setRequired(true)), new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('q3').setLabel('\u041F\u043E\u0447\u0435\u043C\u0443 \u0432\u044B \u0445\u043E\u0442\u0438\u0442\u0435 \u043A \u043D\u0430\u043C?').setStyle(TextInputStyle.Paragraph).setRequired(true)));
        await interaction.showModal(modal).catch(console.error);
    }
    if (interaction.isModalSubmit() && interaction.customId === 'apply_modal') {
        const config = await getConfig(interaction.guildId);
        await interaction.reply({ content: '\u2705 \u0412\u0430\u0448\u0430 \u0437\u0430\u044F\u0432\u043A\u0430 \u0443\u0441\u043F\u0435\u0448\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0430 \u0438 \u0431\u0443\u0434\u0435\u0442 \u0440\u0430\u0441\u0441\u043C\u043E\u0442\u0440\u0435\u043D\u0430!', ephemeral: true });
        if (config && config.adminChannelId) {
            const channel = interaction.guild.channels.cache.get(config.adminChannelId);
            if (channel) {
                const embed = new EmbedBuilder().setTitle('\uD83D\uDCE9 \u041D\u043E\u0432\u0430\u044F \u0437\u0430\u044F\u0432\u043A\u0430').setColor('#5865F2').setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }).addFields({ name: '\u0418\u043C\u044F', value: interaction.fields.getTextInputValue('q1') || '\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430' }, { name: '\u0412\u043E\u0437\u0440\u0430\u0441\u0442', value: interaction.fields.getTextInputValue('q2') || '\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430' }, { name: '\u041F\u043E\u0447\u0435\u043C\u0443 \u0445\u043E\u0447\u0435\u0442 \u043A \u043D\u0430\u043C', value: interaction.fields.getTextInputValue('q3') || '\u041D\u0435\u0442 \u043E\u0442\u0432\u0435\u0442\u0430' }).setFooter({ text: `ID: ${interaction.user.id}` }).setTimestamp();
                await channel.send({ embeds: [embed] }).catch(console.error);
            }
        }
    }
});

// --- API ROUTES ---
app.get('/api/config/:guildId', checkAuth, async (req, res) => { try { const guild = client.guilds.cache.get(req.params.guildId); const config = await getConfig(req.params.guildId); const channels = guild ? Array.from(guild.channels.cache.values()).filter(c => c.type === 0 || c.type === 5).map(c => ({ id: c.id, name: c.name })) : []; res.json({ config, channels, guild: guild ? { name: guild.name, icon: guild.iconURL() } : null }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.post('/api/config/:guildId', checkAuth, async (req, res) => { try { await saveConfig(req.params.guildId, req.body); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/analytics', async (req, res) => { const guildId = req.query.guildId; if (!guildId) return res.status(400).json({ error: 'Missing guildId' }); try { const guild = client.guilds.cache.get(guildId); const stats = await getStats(guildId); res.json({ totalMembers: guild ? guild.memberCount : 0, activeUsers: guild ? guild.members.cache.filter(m => m.presence?.status !== 'offline').size : 0, messagesToday: stats.messagesToday, chartData: [0, 0, 0, 0, 0, 0, stats.messagesToday] }); } catch (e) { res.status(500).json({ error: e.message }); } });

// --- START ---
client.on('ready', () => { console.log(`Logged in as ${client.user.tag}`); });
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
