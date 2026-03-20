import http from 'http';
import https from 'https';
import os from 'os';
import cors from 'cors';
import { buildEscPos } from './escpos';
import type { PrintData } from './escpos';
import { sendToPrinter, pingPrinter } from './printer';
import type { PrinterConfig } from './printer';
import {
  listUsbPrinters,
  sendToUsbPrinter,
  pingUsbPrinter,
} from './usb-printer';
import { scanNetworkPrinters } from './network-scanner';
import { buildTestTicket } from './test-ticket';
import { existsSync, readFileSync } from 'fs';
import { ensureCert, CERT_PATH } from './cert';

const PORT = parseInt(process.env.PORT || '3001', 10);

// ── In-memory printer registry ──────────────────────────────────

const printers = new Map<string, PrinterConfig>();

// ── CORS middleware ──────────────────────────────────────────────

const corsHandler = cors({ origin: true });

function withCors(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) {
  corsHandler(req as never, res as never, next);
}

// ── Helpers ──────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

export function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ── Routes ───────────────────────────────────────────────────────

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  const url = req.url || '/';
  const method = req.method || 'GET';

  // Health check
  if (url === '/health' && method === 'GET') {
    return json(res, 200, { status: 'ok', printers: printers.size });
  }

  // Serve CA certificate for iOS/Android installation
  if (url === '/cert' && method === 'GET') {
    if (!existsSync(CERT_PATH)) {
      return json(res, 404, { error: 'Certificado no encontrado' });
    }
    const certData = readFileSync(CERT_PATH);
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="yako-print-ca.crt"',
      'Content-Length': certData.length,
    });
    return res.end(certData);
  }

  // ── Printers CRUD ──

  if (url === '/printers' && method === 'GET') {
    return json(res, 200, { data: Array.from(printers.values()) });
  }

  if (url === '/printers' && method === 'POST') {
    const body = JSON.parse(await readBody(req)) as PrinterConfig;
    if (!body.id || !body.ip) {
      return json(res, 400, { error: 'id and ip are required' });
    }
    body.port = body.port || 9100;
    body.paperWidth = body.paperWidth === 58 ? 58 : 80;
    printers.set(body.id, body);
    return json(res, 201, { data: body });
  }

  if (url.startsWith('/printers/') && method === 'DELETE') {
    const id = url.split('/')[2];
    printers.delete(id);
    return json(res, 200, { success: true });
  }

  // ── USB Printers discovery ──

  if (url === '/usb-printers' && method === 'GET') {
    const usbPrinters = listUsbPrinters();
    return json(res, 200, { data: usbPrinters });
  }

  // ── Network printer discovery ──

  if (url === '/network-printers' && method === 'GET') {
    try {
      const found = await scanNetworkPrinters();
      return json(res, 200, { data: found });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Scan failed';
      return json(res, 500, { error: message });
    }
  }

  // ── Printer status (check single printer by POST) ──

  if (url === '/printer-status' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as {
        connectionType: 'network' | 'usb';
        ip?: string;
        port?: number;
        usbName?: string;
      };

      let online = false;
      if (body.connectionType === 'usb' && body.usbName) {
        online = pingUsbPrinter(body.usbName);
      } else if (body.ip) {
        online = await pingPrinter({
          id: 'check',
          name: 'check',
          ip: body.ip,
          port: body.port || 9100,
          paperWidth: 80,
        });
      }

      return json(res, 200, { online });
    } catch {
      return json(res, 200, { online: false });
    }
  }

  // ── Test print ──

  if (url === '/test-print' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as {
        connectionType: 'network' | 'usb';
        ip?: string;
        port?: number;
        usbName?: string;
        paperWidth?: 58 | 80;
        businessName?: string;
      };

      const paperWidth = body.paperWidth || 80;
      const ticket = buildTestTicket(paperWidth, body.businessName);

      if (body.connectionType === 'usb') {
        if (!body.usbName) {
          return json(res, 400, { error: 'usbName is required' });
        }
        await sendToUsbPrinter(body.usbName, ticket);
      } else {
        if (!body.ip) {
          return json(res, 400, { error: 'ip is required' });
        }
        await sendToPrinter(
          {
            id: 'test',
            name: 'test',
            ip: body.ip,
            port: body.port || 9100,
            paperWidth,
          },
          ticket,
        );
      }

      return json(res, 200, { success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Test print failed';
      return json(res, 500, { error: message });
    }
  }

  // ── Printer status (registry) ──

  if (url === '/printers/status' && method === 'GET') {
    const results = await Promise.all(
      Array.from(printers.values()).map(async (p) => ({
        id: p.id,
        name: p.name,
        online: await pingPrinter(p),
      })),
    );
    return json(res, 200, { data: results });
  }

  // ── Print ──

  if (url === '/print' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as {
        printerId: string;
        receipt: PrintData;
      };

      const printer = printers.get(body.printerId);
      if (!printer) {
        return json(res, 404, {
          error: `Printer '${body.printerId}' not found`,
        });
      }

      const escposData = buildEscPos({
        ...body.receipt,
        paperWidth: printer.paperWidth,
      });

      await sendToPrinter(printer, escposData);
      return json(res, 200, { success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Print failed';
      return json(res, 500, { error: message });
    }
  }

  // ── Print Direct (app sends printer info inline) ──

  if (url === '/print-direct' && method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as {
        printer: {
          connectionType?: 'network' | 'usb';
          ip?: string;
          port?: number;
          usbName?: string;
          paperWidth: 58 | 80;
        };
        receipt: PrintData;
      };

      const connType = body.printer?.connectionType || 'network';
      const paperWidth = body.printer?.paperWidth || 80;

      const escposData = buildEscPos({
        ...body.receipt,
        paperWidth,
      });

      if (connType === 'usb') {
        if (!body.printer?.usbName) {
          return json(res, 400, {
            error: 'printer.usbName is required for USB connection',
          });
        }
        await sendToUsbPrinter(body.printer.usbName, escposData);
      } else {
        if (!body.printer?.ip) {
          return json(res, 400, {
            error: 'printer.ip is required for network connection',
          });
        }
        const config = {
          id: 'direct',
          name: 'direct',
          ip: body.printer.ip,
          port: body.printer.port || 9100,
          paperWidth,
        };
        await sendToPrinter(config, escposData);
      }

      return json(res, 200, { success: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Print failed';
      return json(res, 500, { error: message });
    }
  }

  // 404
  json(res, 404, { error: 'Not found' });
}

// ── Server ───────────────────────────────────────────────────────

const HTTP_PORT = parseInt(process.env.HTTP_PORT || String(PORT - 1), 10);

export function startServer(): Promise<{
  ip: string;
  port: number;
  httpPort: number;
}> {
  return new Promise((resolve, reject) => {
    const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
      withCors(req, res, () => {
        handleRequest(req, res).catch((err) => {
          console.error('Unhandled error:', err);
          json(res, 500, { error: 'Internal server error' });
        });
      });
    };

    let server: http.Server | https.Server;
    let usingHttps = false;

    try {
      const tls = ensureCert();
      server = https.createServer(tls, handler);
      usingHttps = true;
    } catch {
      // Fallback to HTTP if cert generation fails (e.g. no openssl)
      console.warn('  ⚠ No se pudo crear certificado HTTPS, usando HTTP.');
      server = http.createServer(handler);
    }

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `El puerto ${PORT} ya está en uso. ¿Ya tenés Yako Print corriendo?`,
          ),
        );
      } else {
        reject(err);
      }
    });

    server.listen(PORT, '0.0.0.0', () => {
      const ip = getLocalIp();

      // Start a parallel HTTP server for /cert and /health
      // so devices can download the CA cert before trusting HTTPS
      if (usingHttps) {
        const httpServer = http.createServer(handler);
        httpServer.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.warn(
              `  ⚠ Puerto HTTP ${HTTP_PORT} en uso, /cert solo disponible vía HTTPS.`,
            );
          } else {
            console.warn('  ⚠ No se pudo iniciar servidor HTTP:', err.message);
          }
        });
        httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
          console.log(`  HTTP server on http://${ip}:${HTTP_PORT} (for /cert)`);
        });
      }

      resolve({ ip, port: PORT, httpPort: usingHttps ? HTTP_PORT : PORT });
    });
  });
}

// Auto-start when run directly (fallback)
if (require.main === module) {
  startServer().then(({ ip, port }) => {
    console.log(`Yako Print running at ${ip}:${port}`);
  });
}
