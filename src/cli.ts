#!/usr/bin/env node

import os from 'os';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { startAgent } from './agent';
import { loadConfig, getConfigPath } from './config';

// ── ANSI helpers ────────────────────────────────────────────────

const R = '\x1b[0m';
const B = '\x1b[1m';
const D = '\x1b[2m';
const G = '\x1b[32m';
const C = '\x1b[36m';
const Y = '\x1b[33m';

const CHECK = `${G}✓${R}`;

// ── Flags ───────────────────────────────────────────────────────

const isSetup = process.argv.includes('--setup');

// ── Auto-start registration (write plist / schtasks only) ───────

function registerMacAutoStart(binPath: string): void {
  const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
  const plistPath = path.join(plistDir, 'com.yako.print.plist');

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.yako.print</string>
  <key>ProgramArguments</key>
  <array>
    <string>${binPath}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/yako-print.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/yako-print.log</string>
</dict>
</plist>`;

  mkdirSync(plistDir, { recursive: true });
  writeFileSync(plistPath, plist);

  execSync(`launchctl load "${plistPath}" 2>/dev/null || true`);
}

function registerWindowsAutoStart(binPath: string): void {
  const taskName = 'YakoPrint';

  try {
    execSync(`schtasks /delete /tn "${taskName}" /f 2>nul`, {
      stdio: 'ignore',
    });
  } catch {
    /* no previous task */
  }

  execSync(
    `schtasks /create /tn "${taskName}" /tr "\\"${binPath}\\"" /sc onlogon /rl limited /f`,
    { stdio: 'ignore' },
  );
}

// ── Terminal UI ─────────────────────────────────────────────────

function showBanner() {
  console.log('');
  console.log(
    `  ${D}╭──────────────────────────────────────────────────╮${R}`,
  );
  console.log(
    `  ${D}│${R}                                                  ${D}│${R}`,
  );
  console.log(
    `  ${D}│${R}              ${B}Yako Print v2.0${R}                     ${D}│${R}`,
  );
  console.log(
    `  ${D}│${R}   Agente de impresión para Yako POS               ${D}│${R}`,
  );
  console.log(
    `  ${D}│${R}                                                  ${D}│${R}`,
  );
  console.log(
    `  ${D}╰──────────────────────────────────────────────────╯${R}`,
  );
  console.log('');
}

// ── Setup flow (first-time install) ─────────────────────────────

async function runSetup() {
  const platform = os.platform();
  const platformName = platform === 'darwin' ? 'Mac' : 'Windows';

  showBanner();

  const config = loadConfig();
  if (!config) {
    console.log(
      `  ${Y}⚠${R} No se encontró ${C}config.json${R} en ${D}${getConfigPath()}${R}`,
    );
    console.log('');
    console.log(
      `  Ejecutá el comando de instalación desde la web de Yako POS.`,
    );
    console.log('');
    process.exit(1);
  }

  console.log(`  ${CHECK} Configuración encontrada`);
  console.log(`  ${D}API: ${config.apiUrl}${R}`);
  console.log('');

  // Register auto-start for future reboots
  const binPath = process.execPath;
  if (platform === 'darwin') {
    registerMacAutoStart(binPath);
  } else if (platform === 'win32') {
    registerWindowsAutoStart(binPath);
  }

  console.log(
    `  ${CHECK} Configurado para iniciar con tu ${platformName}`,
  );
  console.log('');

  console.log(`  ${G}¡Listo!${R} Yako Print está corriendo.`);
  console.log(
    `  ${D}Esperando trabajos de impresión desde la nube...${R}`,
  );
  console.log('');

  // Start the agent (runs forever)
  await startAgent();
}

// ── Service flow (background / auto-start by launchd) ───────────

async function runService() {
  console.log('Yako Print v2.0 starting...');
  await startAgent();
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  if (isSetup) {
    await runSetup();
  } else {
    await runService();
  }
}

main().catch((err) => {
  console.error('');
  console.error(
    `  ${Y}Error:${R} ${err instanceof Error ? err.message : err}`,
  );
  console.error('');
  process.exit(1);
});
