import { GatewayIntentBits } from 'discord.js';
import { createBot } from './botCore';

createBot({
  botNumber: 1,
  vcFileSuffix: '1',
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  healthCheckChannelId: process.env.HEALTH_CHECK_CHANNEL_ID,
  selfDeaf: true,
});
