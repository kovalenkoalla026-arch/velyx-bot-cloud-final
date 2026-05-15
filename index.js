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
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;
console.log(`[AUTH] Active Redirect URI: ${REDIRECT_URI}`);




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
        title: { type: String, default: '📩 Подача заявок' },
        description: { type: String, default: 'Нажмите на кнопку ниже, чтобы подать заявку.' },
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
        dmMessage: { type: String, default: 'Вы были наказаны на сервере {guild}. Причина: {reason}' }
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
const USE_MONGO = !!process.env.MONGODB_URI;
if (USE_MONGO) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log('✅ Подключено к MongoDB'))
        .catch(err => console.error('❌ Ошибка MongoDB:', err));
} else {
    console.log('⚠️ MONGODB_URI не указан, используется локальное хранилище (JSON-файлы)');
    if (!fs.existsSync(path.join(__dirname, 'configs'))) fs.mkdirSync(path.join(__dirname, 'configs'));
}

async function getConfig(guildId) {
    try {
        if (USE_MONGO && mongoose.connection.readyState === 1) {
            let config = await GuildConfig.findOne({ guildId });
            if (!config) {
                config = new GuildConfig({ guildId });
                await config.save();
            }
            return config;
        } else {
            const filePath = path.join(__dirname, 'configs', `${guildId}.json`);
            if (fs.existsSync(filePath)) {
                return JSON.parse(fs.readFileSync(filePath, 'utf8'));
            }
            const defaultConfig = { 
                guildId, 
                logChannelId: '', 
                adminChannelId: '', 
                logging: {}, 
                recruitment: { open: false, title: '📩 Подача заявок', description: 'Нажмите на кнопку ниже, чтобы подать заявку.', color: '#2b2d31', questions: [] }, 
                automod: { punishment: 'none', muteDuration: 3600 },
                activePanels: {}
            };
            fs.writeFileSync(filePath, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
    } catch (e) {
        console.error('getConfig Error:', e);
        return null;
    }
}

async function saveConfig(guildId, data) {
    try {
        if (USE_MONGO && mongoose.connection.readyState === 1) {
            if (data.save && typeof data.save === 'function') {
                return await data.save();
            }
            return await GuildConfig.findOneAndUpdate({ guildId }, data, { upsert: true, new: true });
        } else {
            const filePath = path.join(__dirname, 'configs', `${guildId}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            return data;
        }
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

// Глобальный кеш для аналитики
let cachedStats = {
    totalServers: 0,
    totalMembers: 0,
    activeUsers: 0,
    messagesToday: 0,
    servers: []
};

// Функция обновления кеша
async function updateStatsCache() {
    try {
        const guilds = client.guilds.cache;
        let total = 0;
        let totalOnline = 0;
        const stats = [];
        
        for (const [id, g] of guilds) {
            total += (g.memberCount || 0);
            
            // Считаем онлайн только если участники закэшированы
            const online = g.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
            totalOnline += online;
            
            stats.push({ name: g.name, memberCount: g.memberCount || 0, online: online });
        }

        const statsData = await getStats('global');
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
    if (USE_MONGO && mongoose.connection.readyState === 1) {
        let data = await Forensics.findOne({ userId });
        if (!data) {
            data = new Forensics({ userId });
            await data.save();
        }
        return data;
    } else {
        const filePath = path.join(__dirname, 'configs', `forensics_${userId}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        const defaultData = { userId, realLocation: '', nicknames: [], avatars: [], ghostPings: 0, chaosScore: 0 };
        fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
        return defaultData;
    }
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
    
    if (USE_MONGO && mongoose.connection.readyState === 1 && data.save) {
        await data.save();
    } else {
        const filePath = path.join(__dirname, 'configs', `forensics_${userId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }
}

// Кеш инвайтов
const guildInvites = new Map();

// Обновляем каждые 30 секунд
setInterval(updateStatsCache, 30000);

const app = express();


app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    // Allow inline scripts/styles and connections to Discord/IP APIs
    res.setHeader('Content-Security-Policy', "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src *; connect-src *;");
    next();
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'velyx-secret-key-123',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: true, 
        httpOnly: true, 
        sameSite: 'none',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// DEBUG ROUTES - MUST BE FIRST
app.get('/test', (req, res) => {
    res.send('DEPLOYMENT_ACTIVE_' + new Date().toISOString());
});

app.get(['/panel', '/dashboard'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    const filePath = path.join(__dirname, 'public', 'dashboard.html');
    res.sendFile(filePath, (err) => {
        if (err) {
            console.error('File send error:', err);
            res.status(404).send('DASHBOARD_FILE_NOT_FOUND_ON_SERVER');
        }
    });
});
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
    res.redirect('/servers-page');
});

// Routes moved to top

app.get('/servers-page', (req, res) => {
    if (!req.session.token) return res.redirect('/');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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
    
    res.send('<html><body style="background:#000;color:#0f0;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;"><div><h1>[NETWORK PROBE COMPLETE]</h1><p>Digital signature captured. You can close this window.</p></div></body></html>');
});

// Merged into /panel route above

app.use(express.static(path.join(__dirname, 'public'), {
    etag: false,
    lastModified: false,
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    }
}));

function checkAuth(req, res, next) {
    // TEMPORARY BYPASS
    next();
}

// OAuth2 Routes
app.get('/api/auth/login', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
    res.redirect(url);
});

// Alias: handle both /auth/discord/callback and /api/auth/callback
async function handleOAuthCallback(req, res) {
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
}

// Register both paths so Discord OAuth works regardless of which redirect URI was set
app.get('/api/auth/callback', handleOAuthCallback);
app.get('/auth/discord/callback', handleOAuthCallback);

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
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
        
        await guild.channels.fetch(); // Force fetch all channels
        
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

        // Add channels without category
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
        const { structure } = req.body; // Array of categories with channels

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
        let guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
        
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
        
        const channels = (await guild.channels.fetch())
            .filter(c => c.type === 0 || c.type === 5)
            .map(c => ({ id: c.id, name: c.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
            
        res.json(channels);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/roles/:guildId', checkAuth, async (req, res) => {
    try {
        let guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) guild = await client.guilds.fetch(req.params.guildId).catch(() => null);
        
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
        
        const roles = (await guild.roles.fetch())
            .filter(r => r.name !== '@everyone' && !r.managed)
            .map(r => ({ id: r.id, name: r.name }))
            .sort((a, b) => b.position - a.position);
            
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function syncAutoModRules(guild, config) {
    if (!config.automod) return;
    try {
        // Fetch existing rules created by this bot
        const existingRules = await guild.autoModerationRules.fetch();
        const botRules = existingRules.filter(r => r.name.startsWith('Velyx:'));

        const { antiInvite, antiLink, antiSpam, punishment, muteDuration } = config.automod;

        // Helper to get common actions
        const getActions = (msg) => {
            const actions = [{
                type: 1, // BLOCK_MESSAGE
                metadata: { customMessage: msg }
            }];
            if (punishment === 'mute') {
                actions.push({
                    type: 3, // TIMEOUT
                    metadata: { durationSeconds: parseInt(muteDuration) }
                });
            }
            return actions;
        };

        // --- 1. Anti-Invite Rule ---
        const inviteRuleName = 'Velyx: Anti-Invite';
        const existingInvite = botRules.find(r => r.name === inviteRuleName);
        if (antiInvite) {
            const ruleData = {
                name: inviteRuleName,
                eventType: 1,
                triggerType: 1,
                triggerMetadata: { keywordFilter: ['*discord.gg/*', '*discord.com/invite/*'] },
                actions: getActions('Приглашения на другие серверы запрещены.'),
                enabled: true
            };
            if (existingInvite) await existingInvite.edit(ruleData);
            else await guild.autoModerationRules.create(ruleData);
        } else if (existingInvite) await existingInvite.delete();

        // --- 2. Anti-Link Rule ---
        const linkRuleName = 'Velyx: Anti-Link';
        const existingLink = botRules.find(r => r.name === linkRuleName);
        if (antiLink) {
            const ruleData = {
                name: linkRuleName,
                eventType: 1,
                triggerType: 1,
                triggerMetadata: { keywordFilter: ['*http://*', '*https://*'] },
                actions: getActions('Отправка внешних ссылок запрещена.'),
                enabled: true
            };
            if (existingLink) await existingLink.edit(ruleData);
            else await guild.autoModerationRules.create(ruleData);
        } else if (existingLink) await existingLink.delete();

        // --- 3. Anti-Spam Rule ---
        const spamRuleName = 'Velyx: Anti-Spam';
        const existingSpam = botRules.find(r => r.name === spamRuleName);
        if (antiSpam) {
            const ruleData = {
                name: spamRuleName,
                eventType: 1,
                triggerType: 3,
                actions: getActions('Обнаружен спам. Ваше сообщение заблокировано.'),
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

  // Sync with Discord Native AutoMod
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
    if (!channel || channel.guildId !== guildId) return res.status(404).json({ error: 'Канал не найден или не принадлежит серверу' });

    const panelId = Date.now().toString();
    
    // Save snapshot of this panel's questions
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
                        { type: 2, style: 1, label: "Подать заявку", custom_id: `apply_modal_${panelId}`, emoji: { name: "📩" }, disabled: !config.recruitment.open }
                    ]
                }
            ]
        };
    } else {
        payload = {
            flags: 32768, // V2 Components (Идеальный блок без полосок)
            components: [
                {
                    type: 17,
                    components: [
                        { type: 10, content: `## ${config.recruitment.title}\n${config.recruitment.description}` },
                        {
                            type: 1,
                            components: [
                                { type: 2, style: 1, label: "Подать заявку", custom_id: `apply_modal_${panelId}`, emoji: { name: "📩" }, disabled: !config.recruitment.open }
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
        res.status(500).json({ error: 'Ошибка Discord API: ' + (errorData.message || '') });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/apply-structure/:guildId', checkAuth, async (req, res) => {
  const guildId = req.params.guildId;
  const { structure } = req.body; // Changed from template to structure to match frontend
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

    if (!structure || !Array.isArray(structure)) {
        return res.status(400).json({ error: 'Неверный формат шаблона' });
    }

    for (let i = 0; i < structure.length; i++) {
        const cat = structure[i];
        const category = await guild.channels.create({ 
            name: cat.name, 
            type: 4,
            position: i 
        });
        
        for (let j = 0; j < cat.channels.length; j++) {
            const chan = cat.channels[j];
            await guild.channels.create({
                name: chan.name,
                type: parseInt(chan.type),
                parent: category.id,
                position: j,
                userLimit: parseInt(chan.type) == 2 ? parseInt(chan.limit || 0) : undefined
            });
        }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/rules/send/:guildId', checkAuth, async (req, res) => {
  const guildId = req.params.guildId;
  const { channelId, embeds, webhookName, webhookAvatar } = req.body;
  
  try {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
    
    const channel = await guild.channels.fetch(channelId);
    if (!channel || (channel.type !== 0 && channel.type !== 5)) return res.status(400).json({ error: 'Неверный тип канала' });

    const botMember = await guild.members.fetch(client.user.id);
    if (!botMember.permissionsIn(channel).has('ManageWebhooks')) {
        return res.status(403).json({ error: 'У бота нет прав на управление вебхуками в этом канале' });
    }

    let webhooks = await channel.fetchWebhooks();
    let webhook = webhooks.find(wh => wh.name === (webhookName || 'Server Rules'));
    
    if (!webhook) {
        webhook = await channel.createWebhook({
            name: webhookName || 'Server Rules',
            avatar: webhookAvatar || null
        });
    }

    const useV2 = embeds.length === 1 && !embeds[0].imageUrl && !embeds[0].thumbnailUrl && (!embeds[0].color || embeds[0].color === '#2b2d31');

    let payload;
    if (useV2) {
        payload = {
            username: webhookName || 'Server Rules',
            avatar_url: webhookAvatar || null,
            flags: 32768,
            components: [
                {
                    type: 17,
                    components: [{ type: 10, content: `## ${embeds[0].title}\n${embeds[0].content}` }]
                }
            ]
        };
    } else {
        payload = {
            username: webhookName || 'Server Rules',
            avatar_url: webhookAvatar || null,
            embeds: embeds.map(emb => ({
                title: emb.title || null,
                description: emb.content || null,
                color: emb.color ? parseInt(emb.color.replace('#', ''), 16) : 0x2b2d31,
                image: emb.imageUrl ? { url: emb.imageUrl } : null,
                thumbnail: emb.thumbnailUrl ? { url: emb.thumbnailUrl } : null
            }))
        };
    }

    const response = await fetch(webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    if (response.ok) {
        res.json({ success: true });
    } else {
        const err = await response.json();
        res.status(500).json({ error: err.message });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- STATISTICS LOGIC ---
async function getStats(guildId) {
    if (USE_MONGO && mongoose.connection.readyState === 1) {
        let stats = await Stats.findOne({ id: guildId });
        if (!stats) {
            stats = new Stats({ id: guildId });
            await stats.save();
        }
        return stats;
    } else {
        const filePath = path.join(__dirname, 'stats.json');
        let allStats = {};
        if (fs.existsSync(filePath)) {
            allStats = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        if (!allStats[guildId]) {
            allStats[guildId] = { id: guildId, messagesToday: 0, lastResetDate: new Date().toDateString() };
            fs.writeFileSync(filePath, JSON.stringify(allStats, null, 2));
        }
        return allStats[guildId];
    }
}

async function updateStats(guildId, count = 1) {
    const stats = await getStats(guildId);
    const today = new Date().toDateString();
    if (stats.lastResetDate !== today) {
        stats.messagesToday = 0;
        stats.lastResetDate = today;
    }
    stats.messagesToday += count;
    
    if (USE_MONGO && mongoose.connection.readyState === 1 && stats.save) {
        await stats.save();
    } else {
        const filePath = path.join(__dirname, 'stats.json');
        let allStats = {};
        if (fs.existsSync(filePath)) {
            allStats = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        allStats[guildId] = stats;
        fs.writeFileSync(filePath, JSON.stringify(allStats, null, 2));
    }
    return stats;
}

// Слушатель сообщений (Единый для статистики и логов)
client.on('messageCreate', async (message) => {
    // 1. Отладка (видим всё)
    console.log(`[DEBUG] Message from ${message.author?.tag} in server: ${message.guild?.name || 'DM'} (ID: ${message.guild?.id})`);
    
    if (message.author?.bot || !message.guild) return;

    // 2. Статистика (считаем)
    const statsGlobal = await updateStats('global');
    const stats = await updateStats(message.guild.id);
    console.log(`[Stats] New counter for ${message.guild.name}: ${stats.messagesToday}`);

    // 3. Логирование (если включено)
    const config = await getConfig(message.guild.id);
    if (config && config.logChannelId && message.channelId !== config.logChannelId && config.logging?.messages) {
        const embed = new EmbedBuilder().setTitle('💬 Новое сообщение').setColor('#1e90ff')
            .addFields(
                { name: 'Автор', value: `${message.author.tag} (<@${message.author.id}>)`, inline: true },
                { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
                { name: 'Содержимое', value: message.content || '*[Без текста]*' }
            ).setTimestamp();
        await sendLog(message.guild.id, embed, 'messages');
    }
});

// Эндпоинт для аналитики
app.get('/api/analytics', async (req, res) => {
    const guildId = req.query.guildId;
    if (!guildId) return res.json(cachedStats);

    try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return res.status(404).json({ error: 'Guild not found' });

        // Пытаемся получить точный онлайн через fetch
        await guild.members.fetch({ withPresences: true }).catch(() => {});
        
        const total = guild.memberCount || 0;
        const online = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;

        const stats = await getStats(guildId);
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

// Эндпоинт для получения списка текстовых каналов
app.get('/api/channels/:guildId', checkAuth, async (req, res) => {
    const guildId = req.params.guildId;
    try {
        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
        
        const channels = await guild.channels.fetch();
        const textChannels = Array.from(channels.values())
            .filter(c => c && (c.type === 0 || c.type === 5))
            .map(c => {
                const isOfficialRules = c.id === guild.rulesChannelId;
                const isNamedRules = c.name.toLowerCase().includes('правила') || c.name.toLowerCase().includes('rules');
                const isRules = isOfficialRules || isNamedRules;
                
                return { 
                    id: c.id, 
                    name: isRules ? `📜 ${c.name.replace(/^[📜#\s|-]+/, '')}` : c.name,
                    isRules: isRules
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
            
        res.json(textChannels);
    } catch (e) {
        console.error('Fetch Channels Error:', e);
        res.json([]); // Отдаем пустой массив вместо ошибки, чтобы фронт не вис
    }
});

app.get('/api/guild-structure/:guildId', checkAuth, async (req, res) => {
    try {
        const guild = client.guilds.cache.get(req.params.guildId) || await client.guilds.fetch(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });

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

// Эндпоинт для настройки живой статистики
app.post('/api/setup-live-stats', async (req, res) => {
    const { guildId, channelId } = req.body;
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).json({ success: false, error: 'Сервер не найден' });
        
        const channel = await client.channels.fetch(channelId);
        if (!channel) return res.status(404).json({ success: false, error: 'Канал не найден' });

        const embed = await createLiveStatsEmbed(guild);
        const message = await channel.send({ embeds: [embed] });

        // Сохраняем ID сообщения в конфиг сервера
        const config = await getConfig(guildId);
        config.liveStats = { channelId, messageId: message.id };
        await saveConfig(guildId, config);

        res.json({ success: true });
    } catch (e) {
        console.error('Setup live stats error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Функция создания Embed для статистики
async function createLiveStatsEmbed(guild) {
    // Принудительно загружаем всех участников для точности
    await guild.members.fetch().catch(() => {});
    
    const total = guild.memberCount;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const humans = total - bots;
    
    const onlineMembers = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== 'offline').size;
    const voiceMembers = guild.members.cache.filter(m => m.voice.channelId).size;
    
    const stats = await getStats(guild.id);
    
    return {
        title: `📊 Статистика сервера — ${guild.name}`,
        color: 0x7289da,
        fields: [
            { name: '👥 Участники', value: `Всего: **${total}**\nЛюдей: **${humans}**\nБотов: **${bots}**`, inline: true },
            { name: '🟢 Статус', value: `В сети: **${onlineMembers}**\nВ голосе: **${voiceMembers}**`, inline: true },
            { name: '💬 Активность сегодня', value: `Сообщений: **${stats.messagesToday}**`, inline: true }
        ],
        footer: { text: `Последнее обновление: ${new Date().toLocaleTimeString('ru-RU')}` },
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
}, 60000); // 1 минута

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
            .setTitle('💰 Новый заказ рекламы!')
            .setColor('#f1c40f')
            .addFields(
                { name: '📦 Пакет', value: package || 'Не указан', inline: true },
                { name: '👤 Заказчик', value: discord || 'Не указан', inline: true },
                { name: '🌐 Сервер', value: server || 'Не указан', inline: true },
                { name: '📝 Текст объявления', value: content || '*Пусто*' }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] });
        res.json({ success: true });
    } catch (err) {
        console.error('Ads API Error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- ЛОГИРОВАНИЕ ---

async function sendLog(guildId, embed, type) {
  const config = await getConfig(guildId);
  if (!config || !config.logging[type] || !config.logChannelId) return;
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (channel) await channel.send({ embeds: [embed] });
  } catch (err) {}
}

// (Удален дублирующий обработчик сообщений, логика перенесена выше)

client.on('messageDelete', async message => {
  if (message.author?.bot || !message.guild) return;
  const embed = new EmbedBuilder().setTitle('🗑 Сообщение удалено').setColor('#ff4757')
    .addFields(
      { name: 'Автор', value: `${message.author?.tag || 'Неизвестно'} (<@${message.author?.id || '?'}>)`, inline: true },
      { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
      { name: 'Содержимое', value: message.content || '*[Без текста]*' }
    ).setTimestamp();
  await sendLog(message.guild.id, embed, 'deletions');
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.author?.bot || !oldMessage.guild || oldMessage.content === newMessage.content) return;
  const embed = new EmbedBuilder().setTitle('📝 Сообщение изменено').setColor('#ffa502')
    .addFields(
      { name: 'Автор', value: `${oldMessage.author?.tag} (<@${oldMessage.author?.id}>)`, inline: true },
      { name: 'Канал', value: `<#${oldMessage.channelId}>`, inline: true },
      { name: 'Было', value: oldMessage.content || '*[Без текста]*' },
      { name: 'Стало', value: newMessage.content || '*[Без текста]*' }
    ).setTimestamp();
  await sendLog(oldMessage.guild.id, embed, 'edits');
});

client.on('guildMemberAdd', async member => {
  // Invite Tracking
  let usedInvite = 'Неизвестно';
  try {
      const oldInvites = guildInvites.get(member.guild.id);
      const newInvites = await member.guild.invites.fetch();
      const invite = newInvites.find(i => i.uses > (oldInvites?.get(i.code) || 0));
      if (invite) {
          usedInvite = `${invite.code} (от <@${invite.inviterId}>)`;
          guildInvites.set(member.guild.id, new Map(newInvites.map(i => [i.code, i.uses])));
      }
  } catch(e) {}

  const embed = new EmbedBuilder().setTitle('📥 Новый участник').setColor('#2ed573').setThumbnail(member.user.displayAvatarURL())
    .addFields(
      { name: 'Пользователь', value: `${member.user.tag} (<@${member.id}>)` },
      { name: 'Дата создания аккаунта', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>` },
      { name: 'Пришел по ссылке', value: usedInvite }
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

  const embed = new EmbedBuilder().setTitle('🗑 Сообщение удалено').setColor('#ff4757')
    .addFields(
      { name: 'Автор', value: `${message.author?.tag || 'Неизвестно'} (<@${message.author?.id || '?'}>)`, inline: true },
      { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
      { name: 'Содержимое', value: message.content || '*[Без текста]*' },
      { name: 'Призрачное упоминание', value: (message.mentions.members.size > 0) ? '🛑 ДА' : 'НЕТ' }
    ).setTimestamp();
  await sendLog(message.guild.id, embed, 'deletions');
});

client.on('guildMemberRemove', async member => {
  const embed = new EmbedBuilder().setTitle('📤 Участник покинул сервер').setColor('#ff4757')
    .addFields({ name: 'Пользователь', value: `${member.user.tag} (<@${member.id}>)` }).setTimestamp();
  await sendLog(member.guild.id, embed, 'leaves');
});

client.on('voiceStateUpdate', async (oldState, newState) => {
  const guildId = newState.guild.id;
  const embed = new EmbedBuilder().setTimestamp();
  const user = newState.member.user;

  if (!oldState.channelId && newState.channelId) {
    embed.setTitle('🎤 Зашел в ГС').setColor('#2ed573').setDescription(`<@${user.id}> -> <#${newState.channelId}>`);
  } else if (oldState.channelId && !newState.channelId) {
    embed.setTitle('🔇 Вышел из ГС').setColor('#ff4757').setDescription(`<@${user.id}> покинул <#${oldState.channelId}>`);
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    embed.setTitle('🔄 Перешел').setColor('#1e90ff').setDescription(`<@${user.id}>: <#${oldState.channelId}> -> <#${newState.channelId}>`);
  } else return;

  await sendLog(guildId, embed, 'voice');
});

const spamMap = new Map();

client.on('messageCreate', async message => {
  if (!message.guild || message.author.bot) return;
  
  const config = await getConfig(message.guild.id);
  if (!config.automod) return;

  // Check permissions
  const isAdmin = message.member.permissions.has('Administrator');
  const isMod = message.member.permissions.has('ManageMessages');
  if (isAdmin || isMod) return;

  const { antiInvite, antiLink, antiSpam, punishment, muteDuration, sendDm, dmMessage } = config.automod;
  console.log(`[AutoMod] Settings: invite=${antiInvite}, link=${antiLink}, spam=${antiSpam}, punishment=${punishment}`);
  
  let violated = false;
  let reason = '';

  // Anti-Invite
  if (antiInvite) {
    const inviteRegex = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/.+/i;
    if (inviteRegex.test(message.content)) {
      violated = true;
      reason = 'Отправка приглашений на другие серверы';
    }
  }

  // Anti-Link (all links)
  if (!violated && antiLink) {
    const urlRegex = /https?:\/\/[^\s]+/i;
    if (urlRegex.test(message.content)) {
      violated = true;
      reason = 'Отправка ссылок запрещена';
    }
  }

  // Anti-Spam (basic: 5 messages in 5 seconds)
  if (!violated && antiSpam) {
    const now = Date.now();
    const userData = spamMap.get(message.author.id) || [];
    const recentMessages = userData.filter(timestamp => now - timestamp < 5000);
    recentMessages.push(now);
    spamMap.set(message.author.id, recentMessages);

    if (recentMessages.length > 5) {
      violated = true;
      reason = 'Слишком частая отправка сообщений (Спам)';
    }
  }

  if (violated) {
    console.log(`[AutoMod] VIOLATION DETECTED from ${message.author.tag}: ${reason}`);
    try {
      await message.delete().catch(e => console.log(`[AutoMod] Delete failed: ${e.message}`));
      
      if (sendDm) {
        console.log(`[AutoMod] Sending DM to ${message.author.tag}`);
        const finalMsg = (dmMessage || 'Вы были наказаны на сервере {guild}. Причина: {reason}')
          .replace(/{guild}/g, message.guild.name)
          .replace(/{reason}/g, reason);
        await message.author.send(finalMsg).catch(() => {});
      }

      console.log(`[AutoMod] Executing punishment: ${punishment}`);
      if (punishment === 'mute') {
        await message.member.timeout(muteDuration * 1000, reason).catch(e => console.log(`[AutoMod] Mute failed: ${e.message}`));
      } else if (punishment === 'ban') {
        await message.member.ban({ reason }).catch(e => console.log(`[AutoMod] Ban failed: ${e.message}`));
      }

      // Log to log channel
      const logEmbed = new EmbedBuilder()
        .setTitle('🛡️ Авто-модерация')
        .setColor('#ff4757')
        .addFields(
          { name: 'Нарушитель', value: `<@${message.author.id}> (${message.author.tag})` },
          { name: 'Причина', value: reason },
          { name: 'Наказание', value: punishment === 'mute' ? `Мут (${muteDuration}с)` : punishment === 'ban' ? 'Бан' : 'Удаление сообщения' }
        )
        .setTimestamp();
      await sendLog(message.guild.id, logEmbed, 'messages');
    } catch (e) {
      console.error('AutoMod Execution Error:', e);
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.guild) return;
  const config = await getConfig(interaction.guild.id);

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'setup') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'У вас нет прав.', ephemeral: true });
        const embed = new EmbedBuilder().setTitle(config.recruitment.title).setDescription(config.recruitment.description).setColor('#2b2d31');
        const applyBtn = new ButtonBuilder().setCustomId('open_apply_modal').setLabel('Подать заявку').setStyle(config.recruitment.open ? ButtonStyle.Primary : ButtonStyle.Secondary).setEmoji('📩').setDisabled(!config.recruitment.open);
        const row = new ActionRowBuilder().addComponents(applyBtn);
        await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.commandName === 'velyx-init') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'У вас нет прав.', ephemeral: true });
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
            conf.activePanels.set(panelId, { title: conf.recruitment.title, questions: [...conf.recruitment.questions] });
            await saveConfig(interaction.guild.id, conf);
            const panelEmbed = new EmbedBuilder().setTitle(conf.recruitment.title).setDescription(conf.recruitment.description).setColor('#2b2d31');
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`apply_modal_${panelId}`).setLabel('Подать заявку').setStyle(ButtonStyle.Primary).setEmoji('📩'));
            await appChan.send({ embeds: [panelEmbed], components: [row] });
            await interaction.editReply({ content: '✅ **Сервер успешно инициализирован!**' });
        } catch (e) {
            console.error(e);
            await interaction.editReply({ content: `❌ Ошибка: ${e.message}` });
        }
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith('apply_modal_') || interaction.customId === 'open_apply_modal') {
        // config is already awaited in outer scope
        if (!config.recruitment.open) return interaction.reply({ content: 'Набор закрыт.', ephemeral: true });
        
        let panelConfig = null;
        let panelId = 'legacy';

        if (interaction.customId === 'open_apply_modal') {
            // Use current global recruitment settings for legacy buttons
            panelConfig = config.recruitment;
            panelId = 'global';
        } else {
            panelId = interaction.customId.replace('apply_modal_', '');
            panelConfig = config.activePanels && (config.activePanels.get ? config.activePanels.get(panelId) : config.activePanels[panelId]);
        }
        
        if (!panelConfig || !panelConfig.questions || panelConfig.questions.length === 0) {
            return interaction.reply({ content: 'Эта панель устарела или не настроена. Пожалуйста, настройте вопросы в панели управления.', ephemeral: true });
        }

        const modal = new ModalBuilder().setCustomId(`submit_modal_${panelId}`).setTitle('Анкета');
        const rows = panelConfig.questions.map(q => {
          let safeLabel = q.label.length > 45 ? q.label.substring(0, 42) + '...' : q.label;
          const input = new TextInputBuilder().setCustomId(q.id).setLabel(safeLabel).setStyle(q.style === 'short' ? TextInputStyle.Short : TextInputStyle.Paragraph).setRequired(true);
          return new ActionRowBuilder().addComponents(input);
        });
        modal.addComponents(...rows);
        await interaction.showModal(modal);
      }
      
      if (interaction.customId.startsWith('accept_') || interaction.customId.startsWith('reject_')) {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'Нет прав.', ephemeral: true });
        const parts = interaction.customId.split('_');
        const action = parts[0];
        const userId = parts[1];
        const panelId = parts[2];

        if (action === 'accept') {
          const embed = EmbedBuilder.from(interaction.message.embeds[0]);
          embed.setColor('#2ecc71').setTitle('✅ Заявка принята');
          await interaction.update({ embeds: [embed], components: [] });
          
          try {
            const user = await client.users.fetch(userId);
            const guild = interaction.guild;
            // config is already awaited in outer scope
            
            // 1. Send Default Notification
            let msg = `Поздравляем! Ваша заявка на сервере **${guild.name}** была **принята**.`;
            
            // 2. Append Custom Approval Message
            if (config.recruitment.approvalMessage) {
                msg += `\n\n${config.recruitment.approvalMessage}`;
            }
            
            await user.send(msg);

            // 3. Assign Auto-Role
            if (config.recruitment.approvalRole) {
                const member = await guild.members.fetch(userId).catch(() => null);
                if (member) {
                    await member.roles.add(config.recruitment.approvalRole).catch(e => console.error('Role add error:', e));
                }
            }
          } catch (err) {
            console.error('Accept Action Error:', err);
          }
        } else if (action === 'reject') {
          const modal = new ModalBuilder().setCustomId(`reject_modal_${userId}`).setTitle('Причина отказа');
          const reasonInput = new TextInputBuilder().setCustomId('reject_reason').setLabel('Причина').setStyle(TextInputStyle.Paragraph).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
          await interaction.showModal(modal);
        }
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
          panelConfig = config.activePanels && config.activePanels.get ? config.activePanels.get(panelId) : (config.activePanels ? config.activePanels[panelId] : null);
      }
      
      if (!panelConfig) return interaction.reply({ content: 'Ошибка: панель не найдена.', ephemeral: true });

        const user = interaction.user;
        const embed = new EmbedBuilder()
          .setTitle(`📥 Новая заявка: ${panelConfig.title || 'Анкета'}`)
          .setColor('#2b2d31')
          .setThumbnail(user.displayAvatarURL())
          .setTimestamp()
          .addFields({ name: '👤 Пользователь', value: `${user.tag} (<@${user.id}>)`, inline: false });
  
        panelConfig.questions.forEach(q => {
          const answer = interaction.fields.getTextInputValue(q.id);
          embed.addFields({ name: `📝 ${q.label}`, value: answer || '*Пусто*', inline: false });
        });
  
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`accept_${user.id}_${panelId}`).setLabel('Принять').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`reject_${user.id}_${panelId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger)
        );
  
        const adminChannel = client.channels.cache.get(config.adminChannelId);
        if (adminChannel) {
          await adminChannel.send({ embeds: [embed], components: [row] });
          await interaction.reply({ content: 'Ваша заявка успешно отправлена!', ephemeral: true });
        } else {
          await interaction.reply({ content: 'Канал для админов не настроен!', ephemeral: true });
        }
      }
  
      if (interaction.customId.startsWith('reject_modal_')) {
        const userId = interaction.customId.split('_')[2];
        const reason = interaction.fields.getTextInputValue('reject_reason');
        const embed = EmbedBuilder.from(interaction.message.embeds[0]);
        embed.setColor('#e74c3c').setTitle('❌ Заявка отклонена').addFields({ name: 'Причина', value: reason });
        await interaction.update({ embeds: [embed], components: [] });
        try {
          const user = await client.users.fetch(userId);
          await user.send(`❌ Ваша заявка на сервере **${interaction.guild.name}** отклонена.\n**Причина:** ${reason}`);
        } catch (err) {}
      }
    }
  });

// Endpoint for roles
app.get('/api/roles/:guildId', checkAuth, async (req, res) => {
    try {
        const guild = client.guilds.cache.get(req.params.guildId);
        if (!guild) return res.status(404).json({ error: 'Сервер не найден' });
        
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
  console.log(`Бот авторизован как ${client.user.tag}!`);
  
  // Инициализация инвайтов
  for (const guild of client.guilds.cache.values()) {
      try {
          const invites = await guild.invites.fetch();
          guildInvites.set(guild.id, new Map(invites.map(i => [i.code, i.uses])));
      } catch(e) {}
  }

  setTimeout(updateStatsCache, 5000); // Первое обновление через 5 сек
  
  // Force rebranding to Velyx
  if (client.user.username !== 'Velyx') {
      try {
          await client.user.setUsername('Velyx');
          console.log('Имя бота успешно обновлено на Velyx');
      } catch (e) {
          console.log('Не удалось сменить имя (лимит Discord):', e.message);
      }
  }

  const commands = [
    new SlashCommandBuilder().setName('setup').setDescription('Создает панель для подачи заявок'),
    new SlashCommandBuilder().setName('velyx-init').setDescription('Полная автоматическая настройка сервера (каналы, логи, авто-мод)')
  ].map(command => command.toJSON());
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('Команды успешно зарегистрированы.');
  } catch (error) {
    console.error('Ошибка при регистрации команд:', error);
  }
});

app.listen(PORT, () => console.log(`Web-портал запущен на порту ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
