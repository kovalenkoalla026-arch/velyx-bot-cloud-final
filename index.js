require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder, PermissionsBitField, ChannelType, AuditLogEvent } = require('discord.js');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const PORT = process.env.PORT || 3000;
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${PORT}/api/auth/callback`;

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB Connection Error:', err));

const guildConfigSchema = new mongoose.Schema({
        guildId: { type: String, required: true, unique: true },
        logChannelId: { type: String, default: '' },
        adminChannelId: { type: String, default: '' },
        recruitment: {
                  title: { type: String, default: 'Recruitment' },
                  description: { type: String, default: 'Click the button below to apply.' }
        }
});
const GuildConfig = mongoose.model('GuildConfig', guildConfigSchema);

const statsSchema = new mongoose.Schema({
        id: { type: String, default: 'global' },
        messagesToday: { type: Number, default: 0 },
        lastResetDate: { type: Date, default: Date.now }
});
const Stats = mongoose.model('Stats', statsSchema);
const Stats = mongoose.model('Stats', statsSchema);

const forensicsSchema = new mongoose.Schema({
        userId: { type: String, required: true, unique: true },
        nicknames: [String],
        avatars: [String],
        ghostPings: { type: Number, default: 0 }
});
const Forensics = mongoose.model('Forensics', forensicsSchema);

const client = new Client({
        intents: [
                  GatewayIntentBits.Guilds,
                  GatewayIntentBits.GuildMessages,
                  GatewayIntentBits.MessageContent,
                  GatewayIntentBits.GuildMembers,
                  GatewayIntentBits.GuildVoiceStates,
                  GatewayIntentBits.GuildPresences
                ]
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
        secret: 'velyx-secret-key',
        resave: false,
        saveUninitialized: false,
        store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
        cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));

// Helper: send logs
async function sendLog(guild, embed) {
        const config = await GuildConfig.findOne({ guildId: guild.id });
        if (config && config.logChannelId) {
                  const channel = guild.channels.cache.get(config.logChannelId);
                  if (channel) channel.send({ embeds: [embed] });
        }
}
// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/auth/login', (req, res) => {
        const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify%20guilds`;
        res.redirect(url);
});

app.get('/api/auth/callback', async (req, res) => {
        const code = req.query.code;
        if (!code) return res.redirect('/');
        try {
                  const response = await fetch('https://discord.com/api/oauth2/token', {
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
                  const data = await response.json();
                  req.session.token = data.access_token;
                  res.redirect('/panel');
        } catch (err) {
                  res.status(500).send(err.message);
        }
});

app.get('/api/guilds', async (req, res) => {
        if (!req.session.token) return res.status(401).send('Unauthorized');
        const response = await fetch('https://discord.com/api/users/@me/guilds', {
                  headers: { Authorization: `Bearer ${req.session.token}` }
        });
        const guilds = await response.json();
        res.json(guilds.filter(g => (g.permissions & 0x8) === 0x8));
});
app.get('/api/config/:guildId', async (req, res) => {
        const config = await GuildConfig.findOne({ guildId: req.params.guildId });
        res.json(config || {});
});

app.post('/api/config/:guildId', async (req, res) => {
        await GuildConfig.findOneAndUpdate(
              { guildId: req.params.guildId },
              { $set: req.body },
              { upsert: true }
                );
        res.sendStatus(200);
});

// Discord Events
client.once('ready', () => {
        console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async message => {
        if (message.author.bot) return;

            // Simple Stats
            await Stats.findOneAndUpdate({ id: 'global' }, { $inc: { messagesToday: 1 } }, { upsert: true });

            // Simple Automod (Anti-Link)
            const config = await GuildConfig.findOne({ guildId: message.guild.id });
        if (config && config.automod && config.automod.antiLink) {
                  if (message.content.includes('http')) {
                              message.delete();
                              message.channel.send(`${message.author}, links are not allowed!`).then(m => setTimeout(() => m.delete(), 3000));
                  }
        }
});

client.on('interactionCreate', async interaction => {
        if (interaction.isChatInputCommand()) {
                  if (interaction.commandName === 'setup-recruitment') {
                              const config = await GuildConfig.findOne({ guildId: interaction.guild.id });
                              const embed = new EmbedBuilder()
                                .setTitle(config?.recruitment?.title || 'Recruitment')
                                .setDescription(config?.recruitment?.description || 'Click to apply')
                                .setColor('#0099ff');
                              const row = new ActionRowBuilder().addComponents(
                                            new ButtonBuilder().setCustomId('apply_btn').setLabel('Apply').setStyle(ButtonStyle.Primary)
                                          );
                              await interaction.reply({ embeds: [embed], components: [row] });
                  }
        }

            if (interaction.isButton()) {
                      if (interaction.customId === 'apply_btn') {
                                  const modal = new ModalBuilder().setCustomId('apply_modal').setTitle('Application');
                                  const input = new TextInputBuilder().setCustomId('reason').setLabel('Why join?').setStyle(TextInputStyle.Paragraph);
                                  modal.addComponents(new ActionRowBuilder().addComponents(input));
                                  await interaction.showModal(modal);
                      }
            }
});

// Start
app.listen(PORT, () => console.log(`Web server on port ${PORT}`));
client.login(process.env.DISCORD_TOKEN);
