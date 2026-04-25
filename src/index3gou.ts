import dotenv from 'dotenv';
dotenv.config({ path: './3gou.env' });

import { GatewayIntentBits } from 'discord.js';
import { createBot } from './botCore';

createBot({
  botNumber: 3,
  envPath: './3gou.env',
  vcFileSuffix: '3',
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
