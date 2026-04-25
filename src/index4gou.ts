import dotenv from 'dotenv';
dotenv.config({ path: './4gou.env' });

import { GatewayIntentBits } from 'discord.js';
import { createBot } from './botCore';

createBot({
  botNumber: 4,
  envPath: './4gou.env',
  vcFileSuffix: '4',
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
