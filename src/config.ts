import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR =
  process.platform === 'win32'
    ? path.join(
        process.env.LOCALAPPDATA ||
          path.join(os.homedir(), 'AppData', 'Local'),
        'YakoPrint',
      )
    : path.join(os.homedir(), '.yako');

const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  apiUrl: string;
  registrationToken?: string;
  apiKey?: string;
  agentId?: string;
  name?: string;
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function loadConfig(): Config | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveConfig(config: Config): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
