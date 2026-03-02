import { defineConfig } from 'drizzle-kit';
import os from 'node:os';
import path from 'node:path';

function getSafeDefaultDataDir(): string {
  if (process.platform === 'darwin') return path.join(os.homedir(), '.local', 'share', 'treadmagotchi');
  if (process.platform === 'win32') return path.join(os.homedir(), 'AppData', 'Local', 'treadmagotchi');
  const xdg = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdg, 'treadmagotchi');
}

const dataDir = process.env.DATA_DIR || getSafeDefaultDataDir();

export default defineConfig({
  schema: './src/server/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: path.join(dataDir, 'treadmagotchi.db'),
  },
});
