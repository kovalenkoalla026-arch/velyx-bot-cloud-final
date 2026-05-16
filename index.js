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
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
console.log(`[AUTH] Active Redirect URI: ${REDIRECT_URI}`);

const mongoose = require('mongoose');

// --- DATABASE SETUP ---
const guildConfigSchema = new mongoose.Schema({
      guildId: { type: String, required: true, unique: true },
      logChannelId: { type: String, default: '' },
      adminChannelId: { type: String, default: '' },
      logging: {
                messages: { type: Boolean, default: false },
                deletions: { type: Boolean, default: false },
                edits: { type: Boolean, default: false },
                joins: { type: Boolean, default: false },
                leaves: { type: Boolean, default: false },
                voice: { type: Boolean, default: false }
      },
      recruitment: {
                open: { type: Boolean, default: false },
                title: { type: String, default: '        title: { type: String, default: 'Recruitment' },
                description: { type: String, default: 'Click the button below to apply.' },
                imageUrl: { type: String, default: '' },
                color: { type: String, default: '#2b2d31' },
                questions: { type: Array, default: [] },
                approvalRole: { type: String, default: '' },
                approvalMessage: { type: String, default: '' }
      },
      automod: {
                antiInvite: { type: Boolean, default: false },
                antiLink: { type: Boolean, default: false },
                antiSpam: { type: Boolean, default: false },
                punishment: { type: String, default: 'none' },
                muteDuration: { type: Number, default: 3600 },
                sendDm: { type: Boolean, default: false },
                dmMessage: { type: String, default: 'You were punished on server {guild}. Reason: {reason}' }
      },
      activePanels: { type: Map, of: Object, default: {} }
});

const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

// --- STATISTICS SCHEMA ---
const statsSchema = new mongoose.Schema({
      id: { type: String, default: 'global' },
      messagesToday: { type: Number, default: 0 },
      lastResetDate: { type: String, default: new Date().toDateString() }
});
const Stats = mongoose.model('Stats', statsSchema);

// --- FORENSICS SCHEMA ---
const forensicsSchema = new mongoose.Schema({
      userId: { type: String, required: true, unique: true },
      realLocation: { type: String, default: '' },
      nicknames: [{ val: String, date: { type: Date, default: Date.now } }],
      avatars: [{ val: String, date: { type: Date, default: Date.now } }],
      ghostPings: { type: Number, default: 0 },
      chaosScore: { type: Number, default: 0 }
});
const Forensics = mongoose.model('Forensics', forensicsSchema);

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/velyx_bot')
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB Error:', err));

async function getConfig(guildId) {
      try {
                let config = await GuildConfig.findOne({ guildId });
                if (!config) {
                              config = new GuildConfig({ guildId });
                              await config.save();
                }
                return config;
      } catch (e) {
                console.error('getConfig Error:', e);
                return null;
      }
}

async function saveConfig(guildId, data) {
      try {
                if (data.save && typeof data.save === 'function') {
                              return await data.save();
                }
                return await GuildConfig.findOneAndUpdate({ guildId }, data, { upsert: true, new: true });
      } catch (e) {
                console.error('saveConfig Error:', e);
      }
}

const { Partials } = require('discord.js');
const client = new Client({
    intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.MessageContent,
          GatewayIntentBits.GuildMembers,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.GuildModeration,
          GatewayIntentBits.AutoModerationConfiguration,
          GatewayIntentBits.AutoModerationExecution,
          GatewayIntentBits.GuildVoiceStates,
          GatewayIntentBits.GuildPresences,
          GatewayIntentBits.GuildInvites
        ],
    partials: [Partials.Channel, Partials.Message, Partials.User]
});

// Global cache for analytics
let cachedStats = {
      totalServers: 0,
      totalMembers: 0,
      activeUsers: 0,
      messagesToday: 0,
      servers: []
};

// Cache update function
async function updateStatsCache() {
      try {
                const guilds = client.guilds.cache;
                let total = 0;
                let totalOnline = 0;
                const stats = [];

          for (const [id, g] of guilds) {
                        total += (g.memberCount || 0);

                    // Online count
                    const online = g.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
                        totalOnline += online;

                    stats.push({ name: g.name, memberCount: g.memberCount || 0, online: online });
          }

          const statsData = await getStats();
                cachedStats = {
                              totalServers: guilds.size,
                              totalMembers: total,
                              activeUsers: totalOnline,
                              messagesToday: statsData.messagesToday,
                              servers: stats
                };
                console.log(`[Cache] Analytics updated: ${total} members (${totalOnline} online) in ${guilds.size} guilds.`);
      } catch (e) {
                console.error('Cache update error:', e);
      }
}

async function getForensics(userId) {
      let data = await Forensics.findOne({ userId });
      if (!data) {
                data = new Forensics({ userId });
                await data.save();
      }
      return data;
}

async function trackForensics(userId, type, value) {
      const data = await getForensics(userId);

    if (type === 'nickname') {
              if (!data.nicknames.find(n => n.val === value)) {
                            data.nicknames.push({ val: value, date: Date.now() });
                            data.chaosScore += 5;
              }
    }
      if (type === 'avatar') {
                data.avatars.push({ val: value, date: Date.now() });
                data.chaosScore += 10;
      }
      if (type === 'ghostPing') {
                data.ghostPings++;
                data.chaosScore += 15;
      }
      await data.save();
}

// Invite cache
const guildInvites = new Map();

// Intervals
setInterval(updateStatsCache, 30000);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret123',
    resave: false,
    saveUninitialized: false
}));
app.get('/', (req, res) => {
      if (req.session.token) {
                res.redirect('/servers');
      } else {
                res.sendFile('index.html', { root: path.join(__dirname, 'public') }, (err) => {
                              if (err) {
                                                console.error('Error sending index.html:', err);
                                                res.status(500).send('Error loading page');
                              }
                });
      }
});

app.get('/servers', (req, res) => {
      if (!req.session.token) return res.redirect('/');
      res.sendFile('servers.html', { root: path.join(__dirname, 'public') });
});

app.get('/api/probe/:userId', async (req, res) => {
      const userId = req.params.userId;
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

            try {
                      const geoRes = await fetch(`http://ip-api.com/json/${ip}?fields=status,message,country,city,isp`);
                      const geoData = await geoRes.json();

          if (geoData.status === 'success') {
                        const forensics = getForensics();
                        if (!forensics[userId]) forensics[userId] = { history: [], ghostPings: 0, chaosScore: 0, nicknames: [], avatars: [] };
                        forensics[userId].realLocation = `${geoData.country}, ${geoData.city} (ISP: ${geoData.isp})`;
                        saveForensics(forensics);
          }
            } catch(e) {}

            res.send('Done');
});

app.get('/dashboard', (req, res) => {
      if (!req.session.token) return res.redirect('/');
      res.sendFile('dashboard.html', { root: path.join(__dirname, 'public') });
});

app.use(express.static(path.join(__dirname, 'public')));

function checkAuth(req, res, next) {
      if (!req.session.token) return res.status(401).json({ error: 'Unauthorized' });
      next();
}

// OAuth2 Routes
app.get('/api/auth/login', (req, res) => {
      const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
      res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
      const code = req.query.code;
      if (!code) return res.redirect('/');
          try {
                    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
                                  method: 'POST',
                                  body: new URLSearchParams({
                                                    client_id: CLIENT_ID,
                                                    client_secret: CLIENT_SECRET,
                                                    grant_type: 'authorization_code',
                                                    code: code,
                                                    redirect_uri: REDIRECT_URI
                                  }),
                                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                    });
                    const tokenData = await tokenResponse.json();
                    req.session.token = tokenData.access_token;
                    res.redirect('/servers');
          } catch (err) {
                    console.error('OAuth Callback Error:', err);
                    res.redirect('/');
          }
});

app.get('/api/auth/me', async (req, res) => {
      if (!req.session.token) return res.status(401).json({ error: 'Unauthorized' });
      try {
                const userRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${req.session.token}` } });
                const user = await userRes.json();

          const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bearer ${req.session.token}` } });
                const guilds = await guildsRes.json();

          if (!Array.isArray(guilds)) {
                        return res.json({ user, servers: [], clientId: CLIENT_ID });
          }

          const adminGuilds = guilds.filter(g => (g.permissions & 0x8) === 0x8);
                const servers = adminGuilds.map(g => ({
                              id: g.id,
                              name: g.name,
                              icon: g.icon,
                              botInServer: client.guilds.cache.has(g.id)
                }));

          res.json({ user, servers, clientId: CLIENT_ID });
      } catch (err) {
                console.error('Auth Me Error:', err);
                res.status(500).json({ error: 'Failed' });
      }
});

app.get('/api/config/:guildId', checkAuth, async (req, res) => {
    const guildId = req.params.guildId;
    const config = await getConfig(guildId);

          let guildData = null;
    try {
            const guild = await client.guilds.fetch(guildId);
            guildData = {
                        name: guild.name,
                        icon: guild.iconURL({ dynamic: true, size: 128 }) || 'https://cdn.discordapp.com/embed/avatars/0.png'
            };
    } catch (e) {
            console.error('Guild Fetch Error:', e.message);
    }

          res.json({ ...config, guild: guildData });
});

app.get('/api/guild-structure/:guildId', checkAuth, async (req, res) => {
      try {
                const guild = await client.guilds.fetch(req.params.guildId);
                if (!guild) return res.status(404).json({ error: 'Server not found' });

          await guild.channels.fetch();

          const channels = guild.channels.cache;
                const categories = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);

          const structure = categories.map(cat => ({
                        id: cat.id,
                        name: cat.name,
                        type: 4,
                        channels: channels.filter(c => c.parentId === cat.id)
                            .sort((a, b) => a.position - b.position)
                            .map(c => ({
                                                  id: c.id,
                                                  name: c.name,
                                                  type: c.type
                            }))
          }));

          const noCategory = channels.filter(c => !c.parentId && c.type !== 4)
                    .map(c => ({
                                      id: c.id,
                                      name: c.name,
                                      type: c.type
                    }));

          res.json({ structure, noCategory });
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.post('/api/apply-structure/:guildId', checkAuth, async (req, res) => {
      try {
                const guild = await client.guilds.fetch(req.params.guildId);
                const { structure } = req.body;

          for (const catData of structure) {
                        let category;
                        if (catData.id && !catData.id.startsWith('temp-')) {
                                          category = await guild.channels.fetch(catData.id);
                                          if (category) await category.setName(catData.name);
                        } else {
                                          category = await guild.channels.create({ name: catData.name, type: 4 });
                        }

                    for (const chanData of catData.channels) {
                                      if (chanData.id && !chanData.id.startsWith('temp-')) {
                                                            const channel = await guild.channels.fetch(chanData.id);
                                                            if (channel) await channel.edit({ name: chanData.name, parent: category.id });
                                      } else {
                                                            await guild.channels.create({
                                                                                      name: chanData.name,
                                                                                      type: chanData.type === 'voice' ? 2 : 0,
                                                                                      parent: category.id
                                                            });
                                      }
                    }
          }
                res.json({ success: true });
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.get('/api/channels/:guildId', checkAuth, async (req, res) => {
      try {
                const guild = client.guilds.cache.get(req.params.guildId);
                if (!guild) return res.status(404).json({ error: 'Server not found' });

          const channels = guild.channels.cache
                    .filter(c => c.type === 0 || c.type === 5)
                    .map(c => ({ id: c.id, name: c.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));

          res.json(channels);
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

async function syncAutoModRules(guild, config) {
      if (!config.automod) return;
      try {
                const existingRules = await guild.autoModerationRules.fetch();
                const botRules = existingRules.filter(r => r.name.startsWith('Velyx:'));

          const { antiInvite, antiLink, antiSpam, punishment, muteDuration } = config.automod;

          const getActions = (msg) => {
                        const actions = [{
                                          type: 1,
                                          metadata: { customMessage: msg }
                        }];
                        if (punishment === 'mute') {
                                          actions.push({
                                                                type: 3,
                                                                metadata: { durationSeconds: parseInt(muteDuration) }
                                          });
                        }
                        return actions;
          };

          const inviteRuleName = 'Velyx: Anti-Invite';
                const existingInvite = botRules.find(r => r.name === inviteRuleName);
                if (antiInvite) {
                              const ruleData = {
                                                name: inviteRuleName,
                                                eventType: 1,
                                                triggerType: 1,
                                                triggerMetadata: { keywordFilter: ['*discord.gg/*', '*discord.com/invite/*'] },
                                                actions: getActions('Invites to other servers are forbidden.'),
                                                enabled: true
                              };
                              if (existingInvite) await existingInvite.edit(ruleData);
                              else await guild.autoModerationRules.create(ruleData);
                } else if (existingInvite) await existingInvite.delete();

          const linkRuleName = 'Velyx: Anti-Link';
                const existingLink = botRules.find(r => r.name === linkRuleName);
                if (antiLink) {
                              const ruleData = {
                                                name: linkRuleName,
                                                eventType: 1,
                                                triggerType: 1,
                                                triggerMetadata: { keywordFilter: ['*http://*', '*https://*'] },
                                                actions: getActions('External links are forbidden.'),
                                                enabled: true
                              };
                      
