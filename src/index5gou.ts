import dotenv from 'dotenv';
dotenv.config({ path: './5gou.env' });

import { GatewayIntentBits } from 'discord.js';
import { createBot } from './botCore';

createBot({
  botNumber: 5,
  envPath: './5gou.env',
  vcFileSuffix: '5',
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
