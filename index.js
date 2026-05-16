const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, PermissionFlagsBits, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const Strategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, REST, Routes, PermissionFlagsBits, SlashCommandBuilder, ChannelType } = require('discord.js');
require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const passport = require('passport');
const Strategy = require('passport-discord').Strategy;
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB Error:', err));

// Database Schemas
const ConfigSchema = new mongoose.Schema({
    guildId: String,
    logChannelId: String,
    adminChannelId: String,
    automod: {
          antiInvite: { type: Boolean, default: false },
          antiLink: { type: Boolean, default: false },
          antiSpam: { type: Boolean, default: false },
          punishment: { type: String, default: 'none' }
    },
    logging: {
          channels: {
                    joins: String,
                    server: String,
                    voice: String,
                    messages: String,
                    leaves: String
          },
          events: {
                    channelCreate: { type: Boolean, default: true },
                    channelUpdate: { type: Boolean, default: true },
                    channelDelete: { type: Boolean, default: true },
                    roleCreate: { type: Boolean, default: true },
                    roleUpdate: { type: Boolean, default: true },
                    roleDelete: { type: Boolean, default: true },
                    guildUpdate: { type: Boolean, default: true },
                    emojiUpdate: { type: Boolean, default: true },
                    memberRoleUpdate: { type: Boolean, default: true },
                    memberNameUpdate: { type: Boolean, default: true },
                    memberAvatarUpdate: { type: Boolean, default: true },
                    memberBan: { type: Boolean, default: true },
                    memberUnban: { type: Boolean, default: true },
                    memberTimeout: { type: Boolean, default: true },
                    memberTimeoutRemove: { type: Boolean, default: true },
                    messageDelete: { type: Boolean, default: true },
                    messageEdit: { type: Boolean, default: true },
                    messageBulkDelete: { type: Boolean, default: true },
                    memberJoin: { type: Boolean, default: true },
                    memberLeave: { type: Boolean, default: true },
                    voiceJoin: { type: Boolean, default: true },
                    voiceMove: { type: Boolean, default: true },
                    voiceLeave: { type: Boolean, default: true }
          },
          ignoredChannels: [String]
    },
    recruitment: {
          open: { type: Boolean, default: false },
          title: String,
          description: String,
          channelId: String,
          approvalRole: String,
          questions: [{ label: String, style: String }]
    }
}, { minimize: false });

const ApplicationSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    userTag: String,
    userAvatar: String,
    panelId: String,
    panelTitle: String,
    answers: [{ question: String, answer: String }],
    status: { type: String, default: 'pending' },
    rejectionReason: String,
    createdAt: { type: Date, default: Date.now }
});

const StatsSchema = new mongoose.Schema({
    guildId: String,
    date: String,
    messages: { type: Number, default: 0 },
    joins: { type: Number, default: 0 }
});

const Config = mongoose.model('Config', ConfigSchema);
const Application = mongoose.model('Application', ApplicationSchema);
const Stats = mongoose.model('Stats', StatsSchema);

// Cache for stats to avoid heavy DB queries
const statsCache = new Map();

async function updateStatsCache() {
      const today = new Date().toISOString().split('T')[0];
      const stats = await Stats.find({ date: today });
      stats.forEach(s => statsCache.set(`${s.guildId}_${today}`, s.messages));
}

// Passport Setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new Strategy({
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL,
      scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
      process.nextTick(() => done(null, profile));
}));

app.use(session({
      secret: 'velyx-secret-v3',
      resave: false,
      saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
function checkAuth(req, res, next) {
      if (req.isAuthenticated()) return next();
      res.redirect('/auth/discord');
}

// Stats logging middleware
app.use(async (req, res, next) => {
      if (req.path === '/api/stats' && req.query.guildId && req.query.token === process.env.STATS_TOKEN) {
                const guildId = req.query.guildId;
                const today = new Date().toISOString().split('T')[0];

          try {
                        await Stats.findOneAndUpdate(
                          { guildId, date: today },
                          { $inc: { messages: 1 } },
                          { upsert: true }
                                      );

                    const current = statsCache.get(`${guildId}_${today}`) || 0;
                        statsCache.set(`${guildId}_${today}`, current + 1);
          } catch (e) {}
                return res.sendStatus(200);
      }
      next();
});

// Routes
app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', {
      failureRedirect: '/'
}), (req, res) => res.redirect('/servers-page'));

app.get('/servers-page', checkAuth, (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'servers.html'));
});

app.get('/panel', checkAuth, (req, res) => {
      res.sendFile(path.join(__dirname, 'public', 'panel-ultra-final.html'));
});

app.get('/api/user', checkAuth, (req, res) => {
      res.json(req.user);
});

app.get('/api/servers', checkAuth, async (req, res) => {
      const guilds = req.user.guilds.filter(g => (g.permissions & 0x8) === 0x8);
      const botGuilds = client.guilds.cache.map(g => g.id);

            res.json(guilds.map(g => ({
                      ...g,
                      botIn: botGuilds.includes(g.id),
                      iconUrl: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
            })));
});

app.get('/api/config/:guildId', checkAuth, async (req, res) => {
      try {
                const config = await Config.findOne({ guildId: req.params.guildId }) || new Config({ guildId: req.params.guildId });
                const guild = client.guilds.cache.get(req.params.guildId);
                if (!guild) return res.status(404).json({ error: 'Server not found' });

          const channels = guild.channels.cache
                    .filter(c => c.type === 0 || c.type === 5)
                    .map(c => ({ id: c.id, name: c.name }))
                    .sort((a, b) => a.name.localeCompare(b.name));

          res.json({ config, channels, guild: { name: guild.name, icon: guild.iconURL() } });
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.post('/api/config/:guildId', checkAuth, async (req, res) => {
      try {
                await Config.findOneAndUpdate({ guildId: req.params.guildId }, req.body, { upsert: true });
                res.sendStatus(200);
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.get('/api/analytics', checkAuth, async (req, res) => {
      const { guildId } = req.query;
      try {
                const guild = client.guilds.cache.get(guildId);
                if (!guild) return res.status(404).json({ error: 'Server not found' });

          const today = new Date().toISOString().split('T')[0];
                const statsToday = await Stats.findOne({ guildId, date: today });

          // Get last 7 days for chart
          const chartData = [];
                for (let i = 6; i >= 0; i--) {
                              const d = new Date();
                              d.setDate(d.getDate() - i);
                              const dateStr = d.toISOString().split('T')[0];
                              const s = await Stats.findOne({ guildId, date: dateStr });
                              chartData.push(s ? s.messages : 0);
                }

          res.json({
                        totalMembers: guild.memberCount,
                        activeUsers: statsToday ? statsToday.joins : 0, // Simplified
                        messagesToday: statsToday ? statsToday.messages : 0,
                        chartData
          });
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.post('/api/send-panel/:guildId', checkAuth, async (req, res) => {
      const { channelId, adminChannelId } = req.body;
      try {
                const config = await Config.findOne({ guildId: req.params.guildId });
                const channel = client.channels.cache.get(channelId);
                if (!channel) return res.status(404).json({ error: 'Channel not found' });

          const embed = new EmbedBuilder()
                    .setTitle(config.recruitment.title || 'Recruitment')
                    .setDescription(config.recruitment.description || 'Click the button below to apply.')
                    .setColor('#5865f2');

          const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder()
                            .setCustomId(`apply_global`)
                            .setLabel('Apply')
                            .setStyle(ButtonStyle.Primary)
                    );

          await channel.send({ embeds: [embed], components: [row] });
                res.sendStatus(200);
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.get('/api/applications/:guildId', checkAuth, async (req, res) => {
      try {
                const apps = await Application.find({ guildId: req.params.guildId }).sort({ createdAt: -1 }).limit(50);
                res.json(apps);
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

app.post('/api/manage-panel/:guildId/:messageId', checkAuth, async (req, res) => {
      const { action } = req.body;
      const { guildId, messageId } = req.params;

             try {
                       const config = await Config.findOne({ guildId });
                       if (!config || !config.recruitment) return res.status(404).json({ error: 'Config not found' });

          const channel = client.channels.cache.get(config.recruitment.channelId);
                       if (!channel) return res.status(404).json({ error: 'Channel not found' });

          const message = await channel.messages.fetch(messageId);
                       if (action === 'delete') {
                                     await message.delete();
                                     res.sendStatus(200);
                       } else if (action === 'close' || action === 'open') {
                                     const embed = EmbedBuilder.from(message.embeds[0]);
                                     const row = ActionRowBuilder.from(message.components[0]);
                                     row.components[0].setDisabled(action === 'close');
                                     await message.edit({ embeds: [embed], components: [row] });
                                     res.sendStatus(200);
                       }
             } catch (err) {
                       res.status(500).json({ error: err.message });
             }
});

app.post('/api/apply-structure/:guildId', checkAuth, async (req, res) => {
      const { structure, deleteOthers } = req.body;
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).json({ error: 'Server not found' });

             try {
                       if (deleteOthers) {
                                     const channels = await guild.channels.fetch();
                                     for (const c of channels.values()) {
                                                       await c.delete().catch(() => {});
                                     }
                       }

          for (const cat of structure) {
                        const category = await guild.channels.create({
                                          name: cat.name,
                                          type: ChannelType.GuildCategory
                        });

                           for (const ch of cat.channels) {
                                             await guild.channels.create({
                                                                   name: ch.name,
                                                                   type: ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText,
                                                                   parent: category.id
                                             });
                           }
          }
                       res.sendStatus(200);
             } catch (err) {
                       res.status(500).json({ error: err.message });
             }
});

app.get('/api/recruitment-panels/:guildId', checkAuth, async (req, res) => {
      try {
                const config = await Config.findOne({ guildId: req.params.guildId });
                if (!config || !config.recruitment || !config.recruitment.channelId) return res.json([]);

          const channel = client.channels.cache.get(config.recruitment.channelId);
                if (!channel) return res.json([]);

          const messages = await channel.messages.fetch({ limit: 50 });
                const panels = messages.filter(m => m.author.id === client.user.id && m.embeds.length > 0 && m.components.length > 0)
                    .map(m => ({
                                      messageId: m.id,
                                      title: m.embeds[0].title,
                                      status: m.components[0].components[0].disabled ? 'closed' : 'open',
                                      createdAt: m.createdAt
                    }));

          res.json(Array.from(panels.values()));
      } catch (err) {
                res.status(500).json({ error: err.message });
      }
});

// Discord Bot Setup
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

client.on('ready', () => {
      console.log(`Bot logged in as ${client.user.tag}`);
      updateStatsCache();
});

// Recruitment Interaction Handler
client.on('interactionCreate', async interaction => {
      if (interaction.isButton()) {
                if (interaction.customId === 'apply_global') {
                              const config = await Config.findOne({ guildId: interaction.guildId });
                              if (!config || !config.recruitment.open) return interaction.reply({ content: 'Recruitment is currently closed.', ephemeral: true });

                    const modal = new ModalBuilder()
                                  .setCustomId('apply_modal')
                                  .setTitle(config.recruitment.title || 'Application');

                    config.recruitment.questions.forEach((q, i) => {
                                      const input = new TextInputBuilder()
                                          .setCustomId(`q_${i}`)
                                          .setLabel(q.label)
                                          .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
                                          .setRequired(true);
                                      modal.addComponents(new ActionRowBuilder().addComponents(input));
                    });

                    await interaction.showModal(modal);
                }

          if (interaction.customId.startsWith('app_')) {
                        const [_, action, appId] = interaction.customId.split('_');
                        const app = await Application.findById(appId);
                        if (!app) return interaction.reply({ content: 'Application not found.', ephemeral: true });

                    if (action === 'accept') {
                                      app.status = 'accepted';
                                      await app.save();
                                      await interaction.update({ components: [] });
                                      try {
                                                            const user = await client.users.fetch(app.userId);
                                                            await user.send('Your application has been accepted!');
                                      } catch (e) {}
                    } else if (action === 'reject') {
                                      app.status = 'rejected';
                                      await app.save();
                                      await interaction.update({ components: [] });
                                      try {
                                                            const user = await client.users.fetch(app.userId);
                                                            await user.send('Your application has been rejected.');
                                      } catch (e) {}
                    }
          }
      }

              if (interaction.isModalSubmit()) {
                        if (interaction.customId === 'apply_modal') {
                                      const config = await Config.findOne({ guildId: interaction.guildId });
                                      const answers = config.recruitment.questions.map((q, i) => ({
                                                        question: q.label,
                                                        answer: interaction.fields.getTextInputValue(`q_${i}`)
                                      }));

                            const app = new Application({
                                              guildId: interaction.guildId,
                                              userId: interaction.user.id,
                                              userTag: interaction.user.tag,
                                              userAvatar: interaction.user.displayAvatarURL(),
                                              answers,
                                              status: 'pending'
                            });
                                      await app.save();

                            const adminChannel = client.channels.cache.get(config.adminChannelId);
                                      if (adminChannel) {
                                                        const embed = new EmbedBuilder()
                                                            .setTitle('New Application')
                                                            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
                                                            .setColor('#5865f2');

                                          answers.forEach(a => embed.addFields({ name: a.question, value: a.answer }));

                                          const row = new ActionRowBuilder().addComponents(
                                                                new ButtonBuilder().setCustomId(`app_accept_${app._id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
                                                                new ButtonBuilder().setCustomId(`app_reject_${app._id}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
                                                            );

                                          await adminChannel.send({ embeds: [embed], components: [row] });
                                      }

                            await interaction.reply({ content: 'Your application has been submitted!', ephemeral: true });
                        }
              }
});

// Automod
client.on('messageCreate', async message => {
      if (message.author.bot || !message.guild) return;

              const config = await Config.findOne({ guildId: message.guild.id });
      if (!config || !config.automod) return;

              let shouldDelete = false;
      let reason = '';

              if (config.automod.antiInvite && (message.content.includes('discord.gg/') || message.content.includes('discord.com/invite/'))) {
                        shouldDelete = true;
                        reason = 'Invite link';
              }

              if (config.automod.antiLink && !shouldDelete && /https?:\/\/[^\s]+/.test(message.content)) {
                        shouldDelete = true;
                        reason = 'Link';
              }

              if (shouldDelete) {
                        await message.delete().catch(() => {});
                        const logCh = client.channels.cache.get(config.logChannelId);
                        if (logCh) {
                                      logCh.send(`Deleted message from ${message.author.tag} in ${message.channel.name}. Reason: ${reason}`);
                        }
                        return;
              }
});

// Logging Events
const logEvent = async (guild, eventName, description, color, category) => {
      const config = await Config.findOne({ guildId: guild.id });
      if (!config || !config.logging?.events?.[eventName]) return;

      const logChannelId = config.logging.channels?.[category] || config.logChannelId;
      const logCh = client.channels.cache.get(logChannelId);
      if (!logCh) return;

      const embed = new EmbedBuilder()
          .setTitle(description.title)
          .setDescription(description.text)
          .setColor(color)
          .setTimestamp();

      logCh.send({ embeds: [embed] });
};

client.on('channelCreate', ch => logEvent(ch.guild, 'channelCreate', { title: 'Channel Created', text: `Name: ${ch.name}` }, '#3ba55c', 'server'));
client.on('channelDelete', ch => logEvent(ch.guild, 'channelDelete', { title: 'Channel Deleted', text: `Name: ${ch.name}` }, '#ed4245', 'server'));
client.on('guildMemberAdd', mem => logEvent(mem.guild, 'memberJoin', { title: 'Member Joined', text: `${mem.user.tag} joined the server` }, '#3ba55c', 'joins'));
client.on('guildMemberRemove', mem => logEvent(mem.guild, 'memberLeave', { title: 'Member Left', text: `${mem.user.tag} left the server` }, '#ed4245', 'leaves'));

client.login(process.env.DISCORD_TOKEN);
app.listen(PORT, () => console.log(`Dashboard running on port ${PORT}`));

client.on('roleCreate', role => logEvent(role.guild, 'roleCreate', { title: 'Role Created', text: `Name: ${role.name}` }, '#3ba55c', 'server'));
client.on('roleDelete', role => logEvent(role.guild, 'roleDelete', { title: 'Role Deleted', text: `Name: ${role.name}` }, '#ed4245', 'server'));
client.on('messageDelete', msg => {
      if (msg.author?.bot) return;
      logEvent(msg.guild, 'messageDelete', { title: 'Message Deleted', text: `Author: ${msg.author?.tag}\nChannel: ${msg.channel.name}\nContent: ${msg.content}` }, '#ed4245', 'messages');
});
client.on('messageUpdate', (oldMsg, newMsg) => {
      if (oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
      logEvent(oldMsg.guild, 'messageEdit', { title: 'Message Edited', text: `Author: ${oldMsg.author?.tag}\nChannel: ${oldMsg.channel.name}\nOld: ${oldMsg.content}\nNew: ${newMsg.content}` }, '#5865f2', 'messages');
});
