import net from 'net';
import os from 'os';

const PRINTER_PORT = 9100;
const SCAN_TIMEOUT = 1500;
const MAX_CONCURRENT = 30;

export interface NetworkPrinterInfo {
  ip: string;
  port: number;
}

/**
 * Get the local subnet base (e.g. "192.168.1") from the machine's IP.
 */
function getSubnetBase(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        return parts.slice(0, 3).join('.');
      }
    }
  }
  return null;
}

/**
 * Check if a specific IP has port 9100 open.
 */
function probeHost(ip: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(SCAN_TIMEOUT);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, ip);
  });
}

/**
 * Scan the local /24 subnet for devices listening on port 9100.
 * Returns the list of IPs that responded.
 */
export async function scanNetworkPrinters(): Promise<NetworkPrinterInfo[]> {
  const subnet = getSubnetBase();
  if (!subnet) return [];

  const results: NetworkPrinterInfo[] = [];
  const localIp = `${subnet}.${os.networkInterfaces()[Object.keys(os.networkInterfaces())[0]]?.[0]?.address}`;

  // Build list of IPs to scan (1-254), excluding our own
  const myIps = new Set<string>();
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === 'IPv4') {
        myIps.add(iface.address);
      }
    }
  }

  const ips: string[] = [];
  for (let i = 1; i <= 254; i++) {
    const ip = `${subnet}.${i}`;
    if (!myIps.has(ip)) {
      ips.push(ip);
    }
  }

  // Scan in batches to avoid opening too many sockets
  for (let i = 0; i < ips.length; i += MAX_CONCURRENT) {
    const batch = ips.slice(i, i + MAX_CONCURRENT);
    const probes = batch.map(async (ip) => {
      const open = await probeHost(ip, PRINTER_PORT);
      if (open) {
        results.push({ ip, port: PRINTER_PORT });
      }
    });
    await Promise.all(probes);
  }

  return results;
}
