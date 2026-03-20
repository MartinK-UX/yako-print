#!/usr/bin/env node

import os from 'os';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { startServer, getLocalIp } from './server';

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

  // Load so launchd manages it from now on (including after reboot).
  // The server is already running in THIS process, so the daemon
  // launchd spawns will hit EADDRINUSE and exit — but KeepAlive
  // will retry later when this process eventually exits.
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
    `  ${D}│${R}              ${B}Yako Print v1.0${R}                     ${D}│${R}`,
  );
  console.log(
    `  ${D}│${R}   Servidor de impresión para Yako POS             ${D}│${R}`,
  );
  console.log(
    `  ${D}│${R}                                                  ${D}│${R}`,
  );
  console.log(
    `  ${D}╰──────────────────────────────────────────────────╯${R}`,
  );
  console.log('');
}

function showAddress(address: string) {
  console.log(
    `  ${D}──────────────────────────────────────────────────${R}`,
  );
  console.log('');
  console.log(`  ${D}Desde esta computadora:${R}`);
  console.log(`     ${B}${C}➜  localhost:${address.split(':').pop()}${R}`);
  console.log('');
  console.log(`  ${D}Desde otro dispositivo (celular, tablet):${R}`);
  console.log(`     ${B}${C}➜  ${address}${R}`);
  console.log('');
  console.log(`  ${D}Si abrís Yako en esta misma computadora,${R}`);
  console.log(`  ${D}se conecta automáticamente.${R}`);
  console.log('');
  console.log(
    `  ${D}──────────────────────────────────────────────────${R}`,
  );
}

// ── Setup flow (first-time install) ─────────────────────────────

async function runSetup() {
  const platform = os.platform();
  const platformName = platform === 'darwin' ? 'Mac' : 'Windows';

  showBanner();
  console.log(`  Instalando...`);
  console.log('');

  // Start the server directly in this process
  const { ip, port } = await startServer();
  const address = `${ip}:${port}`;

  console.log(`  ${CHECK} Servidor iniciado`);

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

  showAddress(address);
  console.log('');
  console.log(`  ${G}¡Listo!${R} Ya podés cerrar esta ventana.`);
  console.log(
    `  ${D}Yako Print va a seguir funcionando en segundo plano.${R}`,
  );
  console.log('');

  // Stay alive — this process IS the server.
  // When the user closes the terminal, the process dies,
  // but launchd/schtasks will restart it automatically.
}

// ── Service flow (background / auto-start by launchd) ───────────

async function runServer() {
  const { ip, port } = await startServer();
  console.log(`Yako Print running at ${ip}:${port}`);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  if (isSetup) {
    await runSetup();
  } else {
    await runServer();
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
