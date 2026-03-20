import net from 'net';

const DEFAULT_PORT = 9100;
const CONNECT_TIMEOUT = 3000;

export interface PrinterConfig {
  id: string;
  name: string;
  ip: string;
  port: number;
  paperWidth: 58 | 80;
}

/**
 * Send raw ESC/POS data to a thermal printer via TCP.
 */
export function sendToPrinter(
  printer: PrinterConfig,
  data: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.setTimeout(CONNECT_TIMEOUT);

    socket.on('timeout', () => {
      socket.destroy();
      reject(
        new Error(
          `Timeout connecting to ${printer.name} (${printer.ip}:${printer.port})`,
        ),
      );
    });

    socket.on('error', (err) => {
      reject(
        new Error(
          `Error connecting to ${printer.name} (${printer.ip}:${printer.port}): ${err.message}`,
        ),
      );
    });

    socket.connect(printer.port || DEFAULT_PORT, printer.ip, () => {
      socket.write(data, () => {
        socket.end();
        resolve();
      });
    });
  });
}

/**
 * Check if a printer is reachable by attempting a TCP connection.
 */
export function pingPrinter(
  printer: PrinterConfig,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(CONNECT_TIMEOUT);

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

    socket.connect(printer.port || DEFAULT_PORT, printer.ip);
  });
}
