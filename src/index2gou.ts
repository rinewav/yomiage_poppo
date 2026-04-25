import dotenv from 'dotenv';
dotenv.config({ path: './2gou.env' });

import { GatewayIntentBits } from 'discord.js';
import { createBot } from './botCore';

createBot({
  botNumber: 2,
  envPath: './2gou.env',
  vcFileSuffix: '2',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
  ],
  selfDeaf: true,
});
