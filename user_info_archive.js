// --- ADVANCED USER-INFO OSINT COMMAND ARCHIVE (v2.5 DEEP SCAN) ---
// Date: 2026-05-14
// Features: GitHub/Twitch/Steam footprinting, Geo-heuristics, Forensic Chaos Score, Digital Trace analysis.

/*
HANDLER LOGIC (Place inside interactionCreate -> isChatInputCommand):

    if (interaction.commandName === 'user-info') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: 'У вас нет прав.', ephemeral: true });
        try {
            await interaction.deferReply({ ephemeral: true });
            const user = interaction.options.getUser('target') || interaction.user;
            const fullUser = await client.users.fetch(user.id, { force: true }).catch(() => user);
            const member = await interaction.guild.members.fetch(user.id).catch(() => null);
            
            let trustScore = 0;
            const accountAgeDays = Math.floor((Date.now() - user.createdTimestamp) / (1000 * 60 * 60 * 24));
            const accountAgeMonths = Math.floor(accountAgeDays / 30);
            
            if (accountAgeDays > 365) trustScore += 40;
            else if (accountAgeDays > 30) trustScore += 20;
            if (user.avatar) trustScore += 20;
            if (fullUser && fullUser.banner) trustScore += 10;
            if (user.flags && user.flags.toArray().length > 0) trustScore += 30;
            
            const badges = user.flags ? user.flags.toArray().map(f => `\`${f}\``).join(', ') : 'Нет';
            let country = 'Неизвестно (Скрыто)';
            let gender = 'ОПРЕДЕЛЕНИЕ ЗАТРУДНЕНО';

            const mutualServers = client.guilds.cache.filter(g => g.members.cache.has(user.id)).size;

            const embed = new EmbedBuilder()
                .setTitle(`🕵️‍♂️ OSINT-ДОСЬЕ: ${user.tag}`)
                .setDescription(`\`\`\`СИСТЕМА: АНАЛИЗ ОБЪЕКТА ЗАВЕРШЕН [100%]\`\`\`\n**Уровень доверия:** \`${trustScore}%\` ${trustScore > 60 ? '🟢 ВЫСОКИЙ' : trustScore > 30 ? '🟡 СРЕДНИЙ' : '🔴 КРИТИЧЕСКИЙ'}`)
                .setThumbnail(user.displayAvatarURL({ dynamic: true, size: 1024 }))
                .setColor(trustScore > 60 ? '#2ecc71' : trustScore > 30 ? '#f1c40f' : '#e74c3c')
                .addFields(
                    { name: '👤 ОСНОВНАЯ ИДЕНТИФИКАЦИЯ', value: `> **ID:** \`${user.id}\`\n> **Тип:** ${user.bot ? '🤖 Бот-программа' : '👤 Биологический объект'}\n> **Глобальное имя:** \`${user.globalName || 'N/A'}\`\n> **Общих серверов:** \`${mutualServers}\``, inline: false },
                    { name: '⏳ ХРОНОЛОГИЯ', value: `> **Создан:** <t:${Math.floor(user.createdTimestamp / 1000)}:D> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)\n> **Возраст:** \`${accountAgeMonths} мес.\` (\`${accountAgeDays} дн.\`)`, inline: false }
                );

            if (member) {
                const joinTimestamp = Math.floor(member.joinedTimestamp / 1000);
                embed.addFields({ name: '📥 ЛОКАЛЬНЫЕ ДАННЫЕ (SERVER)', value: `> **Вход:** <t:${joinTimestamp}:R>\n> **Высшая роль:** ${member.roles.highest}\n> **Никнейм:** \`${member.nickname || 'Стандарт'}\`\n> **Права админа:** \`${member.permissions.has('Administrator') ? 'ДА' : 'НЕТ'}\``, inline: false });
                
                const memberRoles = member.roles.cache.map(r => r.name.toLowerCase());
                const countryMarkers = { 'россия': '🇷🇺 Россия', 'russia': '🇷🇺 Россия', 'украина': '🇺🇦 Украина', 'ukraine': '🇺🇦 Украина', 'беларусь': '🇧🇾 Беларусь', 'казахстан': '🇰🇿 Казахстан' };
                for (const [key, val] of Object.entries(countryMarkers)) { if (memberRoles.some(r => r.includes(key))) country = `📍 ${val} (Факт по роли)`; }
                const genderMarkers = { 'парень': 'МУЖСКОЙ 👨', 'девушка': 'ЖЕНСКИЙ 👩', 'мужчина': 'МУЖСКОЙ 👨', 'женщина': 'ЖЕНСКИЙ 👩', 'male': 'МУЖСКОЙ 👨', 'female': 'ЖЕНСКИЙ 👩' };
                for (const [key, val] of Object.entries(genderMarkers)) { if (memberRoles.some(r => r.includes(key))) gender = `${val} (Факт по роли)`; }

                if (member.presence) {
                    const devices = [];
                    if (member.presence.clientStatus.desktop) devices.push('💻 PC');
                    if (member.presence.clientStatus.mobile) devices.push('📱 Mobile');
                    if (member.presence.clientStatus.web) devices.push('🌐 Web');
                    const statusMap = { online: '🟢 В сети', idle: '🟡 Нет на месте', dnd: '🔴 Не беспокоить', offline: '⚪ Не в сети' };
                    const currentStatus = statusMap[member.presence.status] || '⚪ Неизвестно';
                    const activities = member.presence.activities.map(a => `\`${a.name}${a.details ? ` (${a.details})` : ''}\``).join(', ') || 'Нет активности';
                    embed.addFields({ name: '📡 ТЕЛЕМЕТРИЯ (LIVE)', value: `> **Статус:** ${currentStatus}\n> **Устройства:** ${devices.join(', ') || 'Засекречено'}\n> **Активность:** ${activities}`, inline: false });
                }
            }

            let possibleName = user.globalName || (member ? member.displayName : user.username);
            const rawName = possibleName;
            const cleanName = rawName.replace(/[0-9]/g, '').replace(/[^\w\sа-яА-ЯёЁ]/gi, '').trim() || rawName;
            const lowerName = cleanName.toLowerCase();
            
            // --- GECO ANALYSIS ---
            if (country === 'Неизвестно (Скрыто)') {
                const geoMarkers = { 'москва': '🇷🇺 Москва', 'питер': '🇷🇺 СПб', 'киев': '🇺🇦 Киев', 'минск': '🇧🇾 Минск' };
                for (const [key, val] of Object.entries(geoMarkers)) { if (lowerName.includes(key)) { country = `📍 ${val}`; break; } }
                if (country === 'Неизвестно (Скрыто)') {
                    if (/[а-яА-ЯёЁ]/.test(rawName)) country = '🇷🇺 Россия / СНГ';
                    else if (interaction.guild.preferredLocale === 'ru') country = '🇷🇺 Россия (По серверу)';
                }
            }

            // --- GENDER ---
            if (gender === 'ОПРЕДЕЛЕНИЕ ЗАТРУДНЕНО') {
                const femaleEndings = ['а', 'я', 'иса', 'ia', 'a'];
                const maleEndings = ['й', 'н', 'р', 'д', 'в', 'к', 'т', 'с', 'м', 'л', 'б', 'k', 'on', 'us'];
                if (femaleEndings.some(e => lowerName.endsWith(e))) gender = 'ЖЕНСКИЙ 👩';
                else if (maleEndings.some(e => lowerName.endsWith(e))) gender = 'МУЖСКОЙ 👨';
            }

            // --- SOCIAL PING ---
            const socialSites = [{ name: 'GitHub', url: `https://github.com/${user.username}` }, { name: 'Twitch', url: `https://www.twitch.tv/${user.username}` }, { name: 'Steam', url: `https://steamcommunity.com/id/${user.username}` }];
            let footprints = [];
            for (const site of socialSites) { try { const res = await fetch(site.url, { method: 'HEAD' }); if (res.ok) footprints.push(`[${site.name}]`); } catch (e) {} }

            embed.addFields({ name: '🧠 ПРЕДПОЛОЖИТЕЛЬНЫЕ ДАННЫЕ', value: `> **Имя:** \`${cleanName}\`\n> **Регион:** \`${country}\`\n> **Пол:** \`${gender}\``, inline: false });
            if (footprints.length > 0) embed.addFields({ name: '🌐 ЦИФРОВОЙ СЛЕД', value: `> Обнаружены совпадения: ${footprints.join(' ')}`, inline: false });
            embed.setFooter({ text: `OSINT Engine v2.5 [DEEP SCAN]` });
            
            if (fullUser && typeof fullUser.bannerURL === 'function' && fullUser.bannerURL()) embed.setImage(fullUser.bannerURL({ dynamic: true, size: 1024 }));

            const probeBtn = new ButtonBuilder().setCustomId(`probe_${user.id}`).setLabel('📡 Запустить сканирование сети').setStyle(ButtonStyle.Danger);
            const row = new ActionRowBuilder().addComponents(probeBtn);
            await interaction.editReply({ embeds: [embed], components: [row] });
        } catch (e) {
            console.error('OSINT Error:', e);
            await interaction.editReply({ content: 'Ошибка при сборе данных.' });
        }
    }

BUTTON LOGIC (Place inside interactionCreate -> isButton):

    if (interaction.customId.startsWith('probe_')) {
        const targetId = interaction.customId.replace('probe_', '');
        const probeUrl = `${REDIRECT_URI.replace('/api/auth/callback', '')}/api/probe/${targetId}`;
        return interaction.reply({ 
            content: `⚠️ **ВНИМАНИЕ: ИНИЦИАЦИЯ СЕТЕВОГО ПЕРЕХВАТА**\nЧтобы получить точные координаты объекта, необходимо подтвердить его цифровой след.\n\n[НАЖМИТЕ ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ](${probeUrl})`, 
            ephemeral: true 
        });
    }

REGISTRATION:

    new SlashCommandBuilder().setName('user-info').setDescription('Показать подробную информацию о пользователе (Админ)')
        .addUserOption(option => option.setName('target').setDescription('Пользователь для проверки').setRequired(false))
*/
