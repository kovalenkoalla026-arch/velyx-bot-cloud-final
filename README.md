# Velyx Bot & Recruitment Portal
Advanced Discord bot with OSINT capabilities and an administrative web dashboard.

## Features
- **Application System**: Professional recruitment workflow with modals and admin approvals.
- **Auto-Mod**: Built-in protection against invites, links, and spam.
- **OSINT (Archived)**: Deep user analysis tools (stored in `user_info_archive.js`).
- **Web Dashboard**: Manage your server settings via a premium web interface.
- **MongoDB Integration**: 24/7 persistence for all configurations and statistics.

## Deployment
This project is ready for deployment on **Railway** or **Render**.
1. Set the environment variables as defined in `.env.example`.
2. Connect a MongoDB database via `MONGODB_URI`.
3. The bot will automatically rebrand to **Velyx** on start.

## Tech Stack
- **Backend**: Node.js, Express, Discord.js
- **Database**: MongoDB (Mongoose)
- **Frontend**: HTML5, Vanilla CSS (Premium Design)
