import { EmbedBuilder, User } from 'discord.js';
import { PROJECT_ROOT } from './constants';

const CUSTOM_EMBED_ICON_URL = process.env.CUSTOM_EMBED_ICON_URL || 'https://images-ext-1.discordapp.net/external/Pu_lp5ZJ-HSprpf6LdXw0ryjI1irJSB03PIdw1hKgWo/%3Fsize%3D1024/https/cdn.discordapp.com/icons/1312756594416554076/a_820e3982adf284631267b5b80815c8d3.gif';
const CUSTOM_EMBED_FOOTER_TEXT = process.env.CUSTOM_EMBED_FOOTER_TEXT || `Copyright © ${new Date().getFullYear()} ぽん酢鯖, All Rights Reserved.`;

class CustomEmbed extends EmbedBuilder {
  constructor(user?: User | null) {
    super();

    this.setColor(0xFF0000);

    this.setFooter({
      text: CUSTOM_EMBED_FOOTER_TEXT,
      iconURL: CUSTOM_EMBED_ICON_URL,
    });

    this.setTimestamp();
  }
}

export default CustomEmbed;