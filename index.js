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
const PORT = process.env.PORT || 3000;
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
                    title: { type: String, default: 'Recruitment' },
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

app.uapp.use(express.static(path.join(__dirname, 'public')));

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
                                    if (existingLink) await existingLink.edit(ruleData);
                                    else await guild.autoModerationRules.create(ruleData);
                    } else if (existingLink) await existingLink.delete();

            const spamRuleName = 'Velyx: Anti-Spam';
                    const existingSpam = botRules.find(r => r.name === spamRuleName);
                    if (antiSpam) {
                                    const ruleData = {
                                                        name: spamRuleName,
                                                        eventType: 1,
                                                        triggerType: 3,
                                                        actions: getActions('Spam detected. Message blocked.'),
                                                        enabled: true
                                    };
                                    if (existingSpam) await existingSpam.edit(ruleData);
                                    else await guild.autoModerationRules.create(ruleData);
                    } else if (existingSpam) await existingSpam.delete();

        } catch (e) {
                    console.error(`[AutoMod Sync Error] Guild ${guild.id}:`, e.message);
        }
}

app.post('/api/config/:guildId', checkAuth, async (req, res) => {
      const guildId = req.params.guildId;
      let conf = await getConfig(guildId);

           if (req.body.logging) conf.logging = { ...conf.logging, ...req.body.logging };
      if (req.body.recruitment) conf.recruitment = { ...conf.recruitment, ...req.body.recruitment };
      if (req.body.automod) conf.automod = { ...conf.automod, ...req.body.automod };
      if (req.body.logChannelId !== undefined) conf.logChannelId = req.body.logChannelId;
      if (req.body.adminChannelId !== undefined) conf.adminChannelId = req.body.adminChannelId;

           await saveConfig(guildId, conf);

           const guild = client.guilds.cache.get(guildId);
      if (guild) {
                await syncAutoModRules(guild, conf);
      }

           res.json({ success: true });
});

app.post('/api/send-panel/:guildId', checkAuth, async (req, res) => {
      const guildId = req.params.guildId;
      const config = await getConfig(guildId);
      try {
              const channel = await client.channels.fetch(req.body.channelId);
              if (!channel || channel.guildId !== guildId) return res.status(404).json({ error: 'Channel not found' });

        const panelId = Date.now().toString();

        config.activePanels = config.activePanels || new Map();
              if (config.activePanels.set) {
                          config.activePanels.set(panelId, { title: config.recruitment.title, questions: [...config.recruitment.questions] });
              } else {
                          config.activePanels[panelId] = { title: config.recruitment.title, questions: [...config.recruitment.questions] };
              }
              await saveConfig(guildId, config);

        const isCustomColor = config.recruitment.color && config.recruitment.color !== '#2b2d31';
              const hasImage = !!config.recruitment.imageUrl;

        let payload;
              if (isCustomColor || hasImage) {
                          payload = {
                                          embeds: [{
                                                              title: config.recruitment.title,
                                                              description: config.recruitment.description,
                                                              color: config.recruitment.color ? parseInt(config.recruitment.color.replace('#', ''), 16) : 0x2b2d31,
                                                              image: hasImage ? { url: config.recruitment.imageUrl } : null
                                          }],
                                          components: [
                                              {
                                                                      type: 1,
                                                                      components: [
                                                                          { type: 2, style: 1, label: "Apply", custom_id: `apply_modal_${panelId}`, emoji: { name: "join" }, disabled: !config.recruitment.open }
                                                                                              ]
                                              }
                                                          ]
                          };
              } else {
                          payload = {
                                          flags: 32768,
                                          components: [
                                              {
                                                                      type: 17,
                                                                      components: [
                                                                          { type: 10, content: `## ${config.recruitment.title}\n${config.recruitment.description}` },
                                                                          {
                                                                                                          type: 1,
                                                                                                          components: [
                                                                                                              { type: 2, style: 1, label: "Apply", custom_id: `apply_modal_${panelId}`, emoji: { name: "join" }, disabled: !config.recruitment.open }
                                                                                                                                          ]
                                                                              }
                                                                                              ]
                                              }
                                                          ]
                          };
              }

        const response = await fetch(`https://discord.com/api/v10/channels/${req.body.channelId}/messages`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
        });

        if (response.ok) {
                    res.json({ success: true });
        } else {
                    const errorData = await response.json();
                    res.status(500).json({ error: 'Discord API Error: ' + (errorData.message || '') });
        }
      } catch (err) {
              res.status(500).json({ error: err.message });
      }
});

client.on('ready', () => {
      console.log(`Logged in as ${client.user.tag}!`);
      updateStatsCache();
});

client.on('messageCreate', async message => {
        if (message.author.bot) return;

              // Analytics
              const stats = await getStats();
        stats.messagesToday++;
        await stats.save();

              // AutoMod Logic
              if (message.guild) {
                          const config = await getConfig(message.guildId);
                          if (config && config.automod) {
                                          const { antiInvite, antiLink, antiSpam } = config.automod;

                              // Native AutoMod handles most, but we can add secondary checks or logging here
                          }
              }
});

client.on('interactionCreate', async interaction => {
        if (interaction.isButton()) {
                    if (interaction.custom_id.startsWith('apply_modal_')) {
                                    const panelId = interaction.custom_id.replace('apply_modal_', '');
                                    const config = await getConfig(interaction.guildId);

                        let panelData;
                                    if (config.activePanels && config.activePanels.get) {
                                                        panelData = config.activePanels.get(panelId);
                                    } else if (config.activePanels) {
                                                        panelData = config.activePanels[panelId];
                                    }

                        if (!panelData) {
                                            return interaction.reply({ content: 'Error: This panel configuration was not found.', ephemeral: true });
                        }

                        const modal = new ModalBuilder()
                                        .setCustomId(`submit_apply_${panelId}`)
                                        .setTitle(panelData.title || 'Application');

                        const components = panelData.questions.map((q, i) => {
                                            return new ActionRowBuilder().addComponents(
                                                                    new TextInputBuilder()
                                                                        .setCustomId(`q_${i}`)
                                                                        .setLabel(q.length > 45 ? q.substring(0, 42) + '...' : q)
                                                                        .setPlaceholder(q)
                                                                        .setStyle(TextInputStyle.Paragraph)
                                                                        .setRequired(true)
                                                                );
                        });

                        modal.addComponents(components);
                                    await interaction.showModal(modal);
                    }

            if (interaction.custom_id.startsWith('approve_') || interaction.custom_id.startsWith('deny_')) {
                            const action = interaction.custom_id.startsWith('approve_') ? 'approved' : 'denied';
                            const [_, userId, panelId] = interaction.custom_id.split('_');

                        await interaction.message.edit({ components: [] });
                            await interaction.reply({ content: `Application ${action} by ${interaction.user.tag}` });

                        try {
                                            const user = await client.users.fetch(userId);
                                            const config = await getConfig(interaction.guildId);

                                if (action === 'approved') {
                                                        if (config.recruitment.approvalRole) {
                                                                                    const member = await interaction.guild.members.fetch(userId);
                                                                                    await member.roles.add(config.recruitment.approvalRole);
                                                        }
                                                        await user.send(config.recruitment.approvalMessage || 'Your application has been approved!');
                                } else {
                                                        await user.send('Your application has been denied.');
                                }
                        } catch (e) {
                                            console.error('Action Notify Error:', e);
                        }
            }
        }

              if (interaction.isModalSubmit()) {
                          if (interaction.custom_id.startsWith('submit_apply_')) {
                                          const panelId = interaction.custom_id.replace('submit_apply_', '');
                                          const config = await getConfig(interaction.guildId);

                              let panelData;
                                          if (config.activePanels && config.activePanels.get) {
                                                              panelData = config.activePanels.get(panelId);
                                          } else if (config.activePanels) {
                                                              panelData = config.activePanels[panelId];
                                          }

                              const answers = panelData.questions.map((q, i) => {
                                                  return { question: q, answer: interaction.fields.getTextInputValue(`q_${i}`) };
                              });

                              const adminChannelId = config.adminChannelId;
                                          if (!adminChannelId) return interaction.reply({ content: 'Error: Admin channel not configured.', ephemeral: true });

                              const adminChannel = await client.channels.fetch(adminChannelId);

                              const embed = new EmbedBuilder()
                                              .setTitle('New Application Received')
                                              .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                                              .setColor(0x00ff00)
                                              .setTimestamp();

                              answers.forEach(a => {
                                                  embed.addFields({ name: a.question, value: a.answer || 'No answer' });
                              });

                              const row = new ActionRowBuilder().addComponents(
                                                  new ButtonBuilder().setCustomId(`approve_${interaction.user.id}_${panelId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                                                  new ButtonBuilder().setCustomId(`deny_${interaction.user.id}_${panelId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                                              );

                              await adminChannel.send({ embeds: [embed], components: [row] });
                                          await interaction.reply({ content: 'Your application has been submitted!', ephemeral: true });
                          }
              }
});

async function getStats() {
        let stats = await Stats.findOne({ id: 'global' });
        if (!stats) {
                    stats = new Stats({ id: 'global' });
                    await stats.save();
        }

    const today = new Date().toDateString();
        if (stats.lastResetDate !== today) {
                    stats.messagesToday = 0;
                    stats.lastResetDate = today;
                    await stats.save();
        }
        return stats;
}

client.login(process.env.DISCORD_TOKEN);

client.on('messageCreate', async message => {
        console.log(`[DEBUG] Message from ${message.author?.tag} in server: ${message.guild?.name || 'DM'} (ID: ${message.guild?.id})`);

              if (message.author?.bot || !message.guild) return;

              // Analytics
              const stats = await getStats();
        console.log(`[Stats] New counter: ${stats.messagesToday}`);

              // Logging
              const config = await getConfig(message.guild.id);
        if (config && config.logChannelId && message.channelId !== config.logChannelId && config.logging?.messages) {
                    const embed = new EmbedBuilder().setTitle('New Message').setColor('#1e90ff')
                        .addFields(
                            { name: 'Author', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
                            { name: 'Content', value: message.content || '*[No Text]*' }
                                        ).setTimestamp();
                    await sendLog(message.guild.id, embed, 'messages');
        }
});

// Analytics Endpoint
app.get('/api/analytics', async (req, res) => {
        const guildId = req.query.guildId;
        if (!guildId) return res.json(cachedStats);

            try {
                        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
                        if (!guild) return res.status(404).json({ error: 'Guild not found' });

            await guild.members.fetch({ withPresences: true }).catch(() => {});

            const total = guild.memberCount || 0;
                        const online = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;

            const stats = await getStats();
                        res.json({
                                        totalMembers: total,
                                        activeUsers: online,
                                        messagesToday: stats.messagesToday,
                                        serverName: guild.name,
                                        chartData: [0, 0, 0, 0, 0, 0, stats.messagesToday]
                        });
            } catch (e) {
                        console.error('Analytics Error:', e);
                        res.status(500).json({ error: e.message });
            }
});

// Channels Endpoint
app.get('/api/channels/:guildId', checkAuth, async (req, res) => {
        const guildId = req.params.guildId;
        try {
                    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
                    if (!guild) return res.status(404).json({ error: 'Server not found' });

            const channels = await guild.channels.fetch();
                    const textChannels = Array.from(channels.values())
                        .filter(c => c && (c.type === 0 || c.type === 5))
                        .map(c => {
                                            const isOfficialRules = c.id === guild.rulesChannelId;
                                            const isNamedRules = c.name.toLowerCase().includes('rules') || c.name.toLowerCase().includes('rules');
                                            const isRules = isOfficialRules || isNamedRules;

                                             return { 
                                                                     id: c.id, 
                                                                     name: isRules ? `[RULES] ${c.name.replace(/^[RULES#\s|-]+/, '')}` : c.name,
                                                                     isRules: isRules
                                             };
                        })
                        .sort((a, b) => a.name.localeCompare(b.name));

            res.json(textChannels);
        } catch (e) {
                    console.error('Fetch Channels Error:', e);
                    res.json([]);
        }
});

app.get('/api/guild-structure/:guildId', checkAuth, async (req, res) => {
        try {
                    const guild = client.guilds.cache.get(req.params.guildId) || await client.guilds.fetch(req.params.guildId);
                    if (!guild) return res.status(404).json({ error: 'Server not found' });

            const channels = await guild.channels.fetch();
                    const categories = Array.from(channels.values())
                        .filter(c => c.type === 4)
                        .sort((a, b) => a.position - b.position);

            const structure = categories.map(cat => {
                            const catChannels = Array.from(channels.values())
                                .filter(c => c.parentId === cat.id)
                                .sort((a, b) => a.position - b.position)
                                .map(ch => ({
                                                        id: ch.id,
                                                        name: ch.name,
                                                        type: ch.type
                                }));

                                                         return {
                                                                             id: cat.id,
                                                                             name: cat.name,
                                                                             channels: catChannels
                                                         };
            });

            res.json({ structure });
        } catch (err) {
                    res.status(500).json({ error: err.message });
        }
});

app.post('/api/setup-live-stats', async (req, res) => {
        const { guildId, channelId } = req.body;

             try {
                         const guild = client.guilds.cache.get(guildId);
                         if (!guild) return res.status(404).json({ success: false, error: 'Server not found' });

            const channel = await client.channels.fetch(channelId);
                         if (!channel) return res.status(404).json({ success: false, error: 'Channel not found' });

            const embed = await createLiveStatsEmbed(guild);
                         const message = await channel.send({ embeds: [embed] });

            const config = await getConfig(guildId);
                         config.liveStats = { channelId, messageId: message.id };
                         await saveConfig(guildId, config);

            res.json({ success: true });
             } catch (e) {
                         console.error('Setup live stats error:', e);
                         res.status(500).json({ success: false, error: e.message });
             }
});

async function createLiveStatsEmbed(guild) {
        await guild.members.fetch().catch(() => {});

    const total = guild.memberCount;
        const bots = guild.members.cache.filter(m => m.user.bot).size;
        const humans = total - bots;

    const onlineMembers = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
        const voiceMembers = guild.members.cache.filter(m => m.voice.channelId).size;

    const stats = await getStats();

    return {
                title: `Server Stats - ${guild.name}`,
                color: 0x7289da,
                fields: [
                    { name: 'Members', value: `Total: **${total}**\nHumans: **${humans}**\nBots: **${bots}**`, inline: true },
                    { name: 'Status', value: `Online: **${onlineMembers}**\nIn Voice: **${voiceMembers}**`, inline: true },
                    { name: 'Activity', value: `Messages Today: **${stats.messagesToday}**`, inline: true }
                            ],
                footer: { text: `Last Update: ${new Date().toLocaleTimeString()}` },
                timestamp: new Date()
    };
}

setInterval(async () => {
        console.log('[LiveStats] Updating messages...');
        try {
                    const configs = await GuildConfig.find({ "liveStats.messageId": { $exists: true } });
                    for (const config of configs) {
                                    const guildId = config.guildId;
                                    try {
                                                        const guild = client.guilds.cache.get(guildId);
                                                        if (!guild) continue;
                                                        const channel = await client.channels.fetch(config.liveStats.channelId);
                                                        const message = await channel.messages.fetch(config.liveStats.messageId);

                                        const embed = await createLiveStatsEmbed(guild);
                                                        await message.edit({ embeds: [embed] });
                                                        console.log(`[LiveStats] Updated for ${guild.name}`);
                                    } catch (e) {
                                                        console.warn(`[LiveStats] Failed to update for guild ${guildId}:`, e.message);
                                    }
                    }
        } catch (e) {
                    console.error('[LiveStats] Error fetching configs:', e);
        }
}, 60000);

app.post('/api/ads', async (req, res) => {
        const { package, discord, server, content } = req.body;
        try {
                    const guildId = client.guilds.cache.first()?.id;
                    const config = guildId ? await getConfig(guildId) : null;
                    const targetChannelId = process.env.ADMIN_CHANNEL_ID || (config ? config.logChannelId : null);

            if (!targetChannelId) return res.status(500).json({ error: 'Admin channel not configured' });

            const channel = await client.channels.fetch(targetChannelId);
                    if (!channel) return res.status(404).json({ error: 'Target channel not found' });

            const embed = new EmbedBuilder()
                        .setTitle('New Advertisement Order!')
                        .setColor('#f1c40f')
                        .addFields(
                            { name: 'Package', value: package || 'Not specified', inline: true },
                            { name: 'Customer', value: discord || 'Not specified', inline: true },
                            { name: 'Server', value: server || 'Not specified', inline: true },
                            { name: 'Content', value: content || '*Empty*' }
                                        )
                        .setTimestamp();

            await channel.send({ embeds: [embed] });
                    res.json({ success: true });
        } catch (err) {
                    console.error('Ads API Error:', err);
                    res.status(500).json({ error: err.message });
        }
});

async function sendLog(guildId, embed, type) {
      const config = await getConfig(guildId);
      if (!config || !config.logging[type] || !config.logChannelId) return;
      try {
              const channel = await client.channels.fetch(config.logChannelId);
              if (channel) await channel.send({ embeds: [embed] });
      } catch (err) {}
}

client.on('messageDelete', async message => {
      if (message.author?.bot || !message.guild) return;
      const embed = new EmbedBuilder().setTitle('Message Deleted').setColor('#ff4757')
        .addFields(
            { name: 'Author', value: `${message.author?.tag || 'Unknown'} (<@${message.author?.id || '?'}>)`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Content', value: message.content || '*[No Text]*' }
                ).setTimestamp();
      await sendLog(message.guild.id, embed, 'deletions');
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
      if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
      const embed = new EmbedBuilder().setTitle('Message Edited').setColor('#ffa502')
        .addFields(
            { name: 'Author', value: `${oldMessage.author?.tag} (<@${oldMessage.author?.id}>)`, inline: true },
            { name: 'Channel', value: `<#${oldMessage.channelId}>`, inline: true },
            { name: 'Before', value: oldMessage.content || '*[No Text]*' },
            { name: 'After', value: newMessage.content || '*[No Text]*' }
                ).setTimestamp();
      await sendLog(oldMessage.guild.id, embed, 'edits');
});

client.on('guildMemberAdd', async member => {
      let usedInvite = 'Unknown';
      try {
                const oldInvites = guildInvites.get(member.guild.id);
                const newInvites = await member.guild.invites.fetch();
                const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
                if (invite) {
                              usedInvite = `${invite.code} (by <@${invite.inviterId}>)`;
                              guildInvites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));
                }
      } catch(e) {}

            const embed = new EmbedBuilder().setTitle('New Member').setColor('#2ed573').setThumbnail(member.user.displayAvatarURL())
        .addFields(
            { name: 'User', value: `${member.user.tag} (<@${member.id}>)` },
            { name: 'Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
            { name: 'Invite Link', value: usedInvite }
                ).setTimestamp();
      await sendLog(member.guild.id, embed, 'joins');
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
        if (oldMember.nickname !== newMember.nickname && newMember.nickname) {
                    trackForensics(newMember.id, 'nickname', newMember.nickname);
        }
});

client.on('userUpdate', (oldUser, newUser) => {
        if (oldUser.avatar !== newUser.avatar) {
                    trackForensics(newUser.id, 'avatar', newUser.displayAvatarURL());
        }
});

client.on('messageDelete', async message => {
      if (message.author?.bot || !message.guild) return;

            // Ghost Ping detection
            if (message.mentions.members.size > 0 || message.mentions.roles.size > 0 || message.mentions.everyone) {
                      trackForensics(message.author.id, 'ghostPing', true);
            }

            const embed = new EmbedBuilder().setTitle('Message Deleted').setColor('#ff4757')
        .addFields(
            { name: 'Author', value: `${message.author?.tag || 'Unknown'} (<@${message.author?.id || '?'}>)`, inline: true },
            { name: 'Channel', value: `<#${message.channelId}>`, inline: true },
            { name: 'Content', value: message.content || '*[No Text]*' },
            { name: 'Ghost Mention', value: (message.mentions.members.size > 0) ? 'YES' : 'NO' }
                ).setTimestamp();
      await sendLog(message.guild.id, embed, 'deletions');
});

client.on('guildMemberRemove', async member => {
      const embed = new EmbedBuilder().setTitle('Member Left').setColor('#ff4757')
        .addFields({ name: 'User', value: `${member.user.tag} (<@${member.id}>)` }).setTimestamp();
      await sendLog(member.guild.id, embed, 'leaves');
});

client.on('voiceStateUpdate', async (oldState, newState) => {
      const guildId = newState.guild.id;
      const embed = new EmbedBuilder().setTimestamp();
      const user = newState.member.user;

            if (!oldState.channelId && newState.channelId) {
                    embed.setTitle('Joined Voice').setColor('#2ed573').setDescription(`<@${user.id}> -> <#${newState.channelId}>`);
            } else if (oldState.channelId && !newState.channelId) {
                    embed.setTitle('Left Voice').setColor('#ff4757').setDescription(`<@${user.id}> left <#${oldState.channelId}>`);
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                    embed.setTitle('Moved Voice').setColor('#1e90ff').setDescription(`<@${user.id}>: <#${oldState.channelId}> -> <#${newState.channelId}>`);
            } else return;

            await sendLog(guildId, embed, 'voice');
});

const spamMap = new Map();

client.on('messageCreate', async message => {
      if (!message.guild || message.author.bot) return;

            const config = await getConfig(message.guild.id);
      if (!config || !config.automod) return;

            const isAdmin = message.member.permissions.has('Administrator');
      const isMod = message.member.permissions.has('ManageMessages');
      if (isAdmin || isMod) return;

            const { antiInvite, antiLink, antiSpam, punishment, muteDuration, sendDm, dmMessage } = config.automod;

            let violated = false;
      let reason = '';

            if (antiInvite) {
                    const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/.+/i;
                    if (inviteRegex.test(message.content)) {
                              violated = true;
                              reason = 'Sending invites to other servers';
                    }
            }

            if (!violated && antiLink) {
                    const urlRegex = /https?:\/\/[^\s]+/i;
                    if (urlRegex.test(message.content)) {
                              violated = true;
                              reason = 'Links are forbidden';
                    }
            }

            if (!violated && antiSpam) {
                    const now = Date.now();
                    const userData = spamMap.get(message.author.id) || [];
                    const recentMessages = userData.filter(timestamp => now - timestamp < 5000);
                    recentMessages.push(now);
                    spamMap.set(message.author.id, recentMessages);

        if (recentMessages.length > 5) {
                  violated = true;
                  reason = 'Spamming messages';
        }
            }

            if (violated) {
                    try {
                              await message.delete().catch(() => {});

                      if (sendDm) {
                                  const finalMsg = (dmMessage || 'You were punished on server {guild}. Reason: {reason}')
                                    .replace(/{guild}/g, message.guild.name)
                                    .replace(/{reason}/g, reason);
                                  await message.author.send(finalMsg).catch(() => {});
                      }

                      if (punishment === 'mute') {
                                  await message.member.timeout(muteDuration * 1000, reason).catch(() => {});
                      } else if (punishment === 'ban') {
                                  await message.member.ban({ reason }).catch(() => {});
                      }

                      const logEmbed = new EmbedBuilder()
                                .setTitle('Auto-Mod Violation')
                                .setColor('#ff4757')
                                .addFields(
                                    { name: 'User', value: `<@${message.author.id}> (${message.author.tag})` },
                                    { name: 'Reason', value: reason },
                                    { name: 'Action', value: punishment === 'mute' ? `Mute (${muteDuration}s)` : punishment === 'ban' ? 'Ban' : 'Delete' }
                                            )
                                .setTimestamp();
                              await sendLog(message.guild.id, logEmbed, 'messages');
                    } catch (e) {}
            }
});

client.on('interactionCreate', async interaction => {
      if (!interaction.guild) return;
      const config = await getConfig(interaction.guild.id);

            if (interaction.isChatInputCommand()) {
                    if (interaction.commandName === 'setup') {
                                if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'No permission.', ephemeral: true });
                                const embed = new EmbedBuilder().setTitle(config.recruitment.title).setDescription(config.recruitment.description).setColor('#2b2d31');
                                const applyBtn = new ButtonBuilder().setCustomId('open_apply_modal').setLabel('Apply').setStyle(config.recruitment.open ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(!config.recruitment.open);
                                const row = new ActionRowBuilder().addComponents(applyBtn);
                                await interaction.reply({ embeds: [embed], components: [row] });
                    }

        if (interaction.commandName === 'velyx-init') {
                    if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'No permission.', ephemeral: true });
                    await interaction.deferReply({ ephemeral: true });
                    try {
                                    const category = await interaction.guild.channels.create({ name: 'VELYX SYSTEM', type: 4 });
                                    const logChan = await interaction.guild.channels.create({ name: 'logs', type: 0, parent: category.id });
                                    const appChan = await interaction.guild.channels.create({ name: 'applications', type: 0, parent: category.id });
                                    let conf = await getConfig(interaction.guild.id);
                                    conf.logChannelId = logChan.id;
                                    conf.adminChannelId = logChan.id;
                                    conf.logging = { messages: true, deletions: true, edits: true, joins: true, leaves: true, voice: true };
                                    conf.recruitment.open = true;
                                    await saveConfig(interaction.guild.id, conf);
                                    await syncAutoModRules(interaction.guild, conf);
                                    const panelId = Date.now().toString();
                                    conf.activePanels = conf.activePanels || new Map();
                                    if (conf.activePanels.set) conf.activePanels.set(panelId, { title: conf.recruitment.title, questions: [...conf.recruitment.questions] });
                                    else conf.activePanels[panelId] = { title: conf.recruitment.title, questions: [...conf.recruitment.questions] };
                                    await saveConfig(interaction.guild.id, conf);
                                    const panelEmbed = new EmbedBuilder().setTitle(conf.recruitment.title).setDescription(conf.recruitment.description).setColor('#2b2d31');
                                    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`apply_modal_${panelId}`).setLabel('Apply').setStyle(ButtonStyle.Primary));
                                    await appChan.send({ embeds: [panelEmbed], components: [row] });
                                    await interaction.editReply({ content: 'Server initialized!' });
                    } catch (e) {
                                    await interaction.editReply({ content: `Error: ${e.message}` });
                    }
        }
            }

            if (interaction.iutton()) {
                    if (interaction.customId.startsWith('apply_modal_') || interaction.customId === 'open_apply_modal') {
                                const config = await getConfig(interaction.guild.id);
                                if (!config.recruitment.open) return interaction.reply({ content: 'Recruitment closed.', ephemeral: true });

                        let panelConfig = null;
                                let panelId = 'legacy';

                        if (interaction.customId === 'open_apply_modal') {
                                        panelConfig = config.recruitment;
                                        panelId = 'global';
                        } else {
                                        panelId = interaction.customId.replace('apply_modal_', '');
                                        panelConfig = config.activePanels && (config.activePanels.get ? config.activePanels.get(panelId) : config.activePanels[panelId]);
                        }

                        if (!panelConfig || !panelConfig.questions || panelConfig.questions.length === 0) {
                                        return interaction.reply({ content: 'This panel is outdated or not configured.', ephemeral: true });
                        }

                        const modal = new ModalBuilder().setCustomId(`submit_modal_${panelId}`).setTitle('Application');
                                const rows = panelConfig.questions.map((q, i) => {
                                              let safeLabel = q.length > 45 ? q.substring(0, 42) + '...' : q;
                                              const input = new TextInputBuilder().setCustomId(`q_${i}`).setLabel(safeLabel).setStyle(TextInputStyle.Paragraph).setRequired(true);
                                              return new ActionRowBuilder().addComponents(input);
                                });
                                modal.addComponents(...rows);
                                await interaction.showModal(modal);
                    }

          if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
                        const [action, userId, panelId] = interaction.customId.split('_');
                        const isApprove = action === 'approve';

                          const embed = EmbedBuilder.from(interaction.message.embeds[0]);
                        embed.setColor(isApprove ? '#2ecc71' : '#e74c3c').setTitle(isApprove ? 'Application Approved' : 'Application Denied');
                        await interaction.update({ embeds: [embed], components: [] });

                          try {
                                            const user = await client.users.fetch(userId);
                                            const config = await getConfig(interaction.guildId);

                            if (isApprove) {
                                                  if (config.recruitment.approvalRole) {
                                                                            const member = await interaction.guild.members.fetch(userId).catch(() => null);
                                                                            if (member) await member.roles.add(config.recruitment.approvalRole).catch(() => {});
                                                  }
                                                  await user.send(config.recruitment.approvalMessage || 'Your application has been approved!');
                            } else {
                                                  await user.send('Your application has been denied.');
                            }
                          } catch (e) {}
          }
            }

            if (interaction.isModalSubmit()) {
                    if (interaction.customId.startsWith('submit_modal_')) {
                              const config = await getConfig(interaction.guild.id);
                              const panelId = interaction.customId.replace('submit_modal_', '');

                      let panelConfig = null;
                              if (panelId === 'global') {
                                            panelConfig = config.recruitment;
                              } else {
                                            panelConfig = config.activePanels && (config.activePanels.get ? config.activePanels.get(panelId) : config.activePanels[panelId]);
                              }

                      if (!panelConfig) return interaction.reply({ content: 'Error: Panel not found.', ephemeral: true });

                        const user = interaction.user;
                                const embed = new EmbedBuilder()
                                  .setTitle(`New Application: ${panelConfig.title || 'Form'}`)
                                  .setColor('#2b2d31')
                                  .setThumbnail(user.displayAvatarURL())
                                  .setTimestamp()
                                  .addFields({ name: 'User', value: `${user.tag} (<@${user.id}>)`, inline: false });

                        panelConfig.questions.forEach((q, i) => {
                                      const answer = interaction.fields.getTextInputValue(`q_${i}`);
                                      embed.addFields({ name: q, value: answer || '*Empty*', inline: false });
                        });

                        const row = new ActionRowBuilder().addComponents(
                                      new ButtonBuilder().setCustomId(`approve_${user.id}_${panelId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
                                      new ButtonBuilder().setCustomId(`deny_${user.id}_${panelId}`).setLabel('Deny').setStyle(ButtonStyle.Danger)
                                    );

                        const adminChannel = await client.channels.fetch(config.adminChannelId).catch(() => null);
                                if (adminChannel) {
                                              await adminChannel.send({ embeds: [embed], components: [row] });
                                              await interaction.reply({ content: 'Application submitted!', ephemeral: true });
                                } else {
                                              await interaction.reply({ content: 'Admin channel not configured!', ephemeral: true });
                                }
                    }
            }
});

app.get('/api/roles/:guildId', checkAuth, async (req, res) => {
        try {
                    const guild = client.guilds.cache.get(req.params.guildId);
                    if (!guild) return res.status(404).json({ error: 'Server not found' });

            const roles = guild.roles.cache
                        .filter(r => r.name !== '@everyone' && !r.managed)
                        .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
                        .sort((a, b) => b.position - a.position);

            res.json(roles);
        } catch (err) {
                    res.status(500).json({ error: err.message });
        }
});

client.on('ready', async () => {
      console.log(`Bot logged in as ${client.user.tag}!`);

            for (const guild of client.guilds.cache.values()) {
                      try {
                                    const invites = await guild.invites.fetch();
                                    guildInvites.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
                      } catch(e) {}
            }

            setTimeout(updateStatsCache, 5000);

            const commands = [
                    new SlashCommandBuilder().setName('setup').setDescription('Creates a recruitment panel'),
                    new SlashCommandBuilder().setName('velyx-init').setDescription('Full automatic server setup')
                  ].map(command => command.toJSON());

            const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      try {
              await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
              console.log('Commands registered.');
      } catch (error) {
              console.error('Error registering commands:', error);
      }
});

app.listen(PORT, () => console.log(`Web portal running on port ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
