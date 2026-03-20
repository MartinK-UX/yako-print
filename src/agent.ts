import os from 'os';
import crypto from 'crypto';
import { ApiClient, ApiError } from './api';
import type { PrintJob } from './api';
import { loadConfig, saveConfig, getConfigPath } from './config';
import type { Config } from './config';
import { buildEscPos } from './escpos';
import type { PrintData } from './escpos';
import { sendToPrinter } from './printer';
import { sendToUsbPrinter } from './usb-printer';

// ── Constants ────────────────────────────────────────────────────

const POLL_INTERVAL = 3_000;
const HEARTBEAT_INTERVAL = 30_000;
const MAX_BACKOFF = 60_000;

// ── ANSI ─────────────────────────────────────────────────────────

const R = '\x1b[0m';
const D = '\x1b[2m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const RED = '\x1b[31m';

// ── Helpers ──────────────────────────────────────────────────────

function getMachineId(): string {
  const hostname = os.hostname();
  const interfaces = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (
        !iface.internal &&
        iface.mac &&
        iface.mac !== '00:00:00:00:00:00'
      ) {
        mac = iface.mac;
        break;
      }
    }
    if (mac) break;
  }
  return crypto
    .createHash('sha256')
    .update(`${hostname}:${mac}`)
    .digest('hex')
    .slice(0, 16);
}

function log(msg: string) {
  const ts = new Date().toLocaleTimeString('es-AR');
  console.log(`  ${D}${ts}${R}  ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Registration ─────────────────────────────────────────────────

async function ensureRegistered(
  config: Config,
  api: ApiClient,
): Promise<Config> {
  if (config.apiKey) {
    api.setApiKey(config.apiKey);
    return config;
  }

  if (!config.registrationToken) {
    throw new Error(
      'No se encontró registrationToken en config.json.\n' +
        '  Ejecutá el comando de instalación desde la web de Yako POS.',
    );
  }

  log('Registrando agent...');
  const machineId = getMachineId();
  const name = os.hostname();
  const result = await api.register(
    name,
    machineId,
    config.registrationToken,
  );

  config.apiKey = result.apiKey;
  config.agentId = result.id;
  config.name = result.name;
  saveConfig(config);

  log(`${G}✓${R} Registrado como "${result.name}"`);
  api.setApiKey(result.apiKey);
  return config;
}

// ── Job processing ───────────────────────────────────────────────

async function processJob(
  job: PrintJob,
  api: ApiClient,
): Promise<void> {
  const shortId = job.id.slice(0, 8);
  log(`Imprimiendo ${shortId}... (${job.type})`);

  await api.updateJobStatus(job.id, 'PRINTING');

  try {
    const payload = JSON.parse(job.payload) as PrintData;
    payload.paperWidth = payload.paperWidth || job.printer.paperWidth;

    const escposData = buildEscPos(payload);

    if (job.printer.connectionType === 'usb') {
      await sendToUsbPrinter(job.printer.usbName, escposData);
    } else {
      await sendToPrinter(
        {
          id: job.printer.id,
          name: job.printer.name,
          ip: job.printer.ip,
          port: job.printer.port || 9100,
          paperWidth: job.printer.paperWidth,
        },
        escposData,
      );
    }

    await api.updateJobStatus(job.id, 'COMPLETED');
    log(`${G}✓${R} ${shortId} completado`);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    await api.updateJobStatus(job.id, 'FAILED', message).catch(() => {});
    log(`${RED}✗${R} ${shortId} falló: ${message}`);
  }
}

// ── Main loop ────────────────────────────────────────────────────

export async function startAgent(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    throw new Error(
      `No se encontró config.json en ${getConfigPath()}\n` +
        '  Ejecutá el comando de instalación desde la web de Yako POS.',
    );
  }

  const api = new ApiClient(config.apiUrl);
  let currentConfig = await ensureRegistered(config, api);

  log('Esperando trabajos de impresión...');

  let lastHeartbeat = Date.now();
  let backoff = POLL_INTERVAL;

  while (true) {
    try {
      const jobs = await api.getPendingJobs();
      backoff = POLL_INTERVAL;

      for (const job of jobs) {
        await processJob(job, api);
      }

      if (
        jobs.length === 0 &&
        Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL
      ) {
        await api.heartbeat();
        lastHeartbeat = Date.now();
      }
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 401) {
        log(`${Y}⚠${R} API key inválida, re-registrando...`);
        delete currentConfig.apiKey;
        delete currentConfig.agentId;
        saveConfig(currentConfig);
        try {
          currentConfig = await ensureRegistered(currentConfig, api);
        } catch (regErr) {
          const msg =
            regErr instanceof Error ? regErr.message : 'Error desconocido';
          log(`${RED}✗${R} Re-registro falló: ${msg}`);
        }
      } else {
        const msg =
          err instanceof Error ? err.message : 'Error desconocido';
        log(
          `${Y}⚠${R} ${msg} — reintentando en ${Math.round(backoff / 1000)}s`,
        );
        backoff = Math.min(backoff * 2, MAX_BACKOFF);
      }
    }

    await sleep(backoff);
  }
}
