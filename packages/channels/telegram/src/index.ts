export { TelegramChannel } from './TelegramAdapter.js';

import { TelegramChannel } from './TelegramAdapter.js';
import type { ChannelPlugin } from '@axe/channel-base';

export const plugin: ChannelPlugin = {
  channelType: 'telegram',
  displayName: 'Telegram',
  requiredConfigFields: ['token'],
  createChannel: (name, config, bridge, options) =>
    new TelegramChannel(name, config, bridge, options),
};
