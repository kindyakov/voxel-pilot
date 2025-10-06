import 'dotenv/config';
import { mineflayer as mineFlayerViewer } from 'prismarine-viewer';
import type { Bot } from '../../types'

export const initViewer = (bot: Bot) => {
  mineFlayerViewer(bot, { port: process.env.MINECRAFT_VIEWER_PORT || 3000, firstPerson: true })
}