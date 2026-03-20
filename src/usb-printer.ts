import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

const platform = process.platform;

export interface UsbPrinterInfo {
  name: string;
  status: string;
}

/**
 * List USB/local printers installed on the OS.
 */
export function listUsbPrinters(): UsbPrinterInfo[] {
  try {
    if (platform === 'darwin' || platform === 'linux') {
      return listUnixPrinters();
    } else if (platform === 'win32') {
      return listWindowsPrinters();
    }
    return [];
  } catch (err) {
    console.error('Error listing USB printers:', err);
    return [];
  }
}

function listUnixPrinters(): UsbPrinterInfo[] {
  // lpstat -p lists all printers with status
  const output = execSync('lpstat -p 2>/dev/null || true', {
    encoding: 'utf-8',
    timeout: 5000,
  });

  const printers: UsbPrinterInfo[] = [];
  for (const line of output.split('\n')) {
    // Format: "printer PrinterName is idle." or "printer PrinterName disabled since ..."
    const match = line.match(/^printer\s+(\S+)\s+(.*)/);
    if (match) {
      printers.push({
        name: match[1],
        status: match[2].includes('idle') ? 'idle' : 'busy',
      });
    }
  }
  return printers;
}

function listWindowsPrinters(): UsbPrinterInfo[] {
  const output = execSync(
    'powershell -Command "Get-Printer | Select-Object -Property Name,PrinterStatus | ConvertTo-Json"',
    { encoding: 'utf-8', timeout: 10000 },
  );

  if (!output.trim()) return [];

  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed) ? parsed : [parsed];

  return items.map(
    (p: { Name: string; PrinterStatus: number }) => ({
      name: p.Name,
      status: p.PrinterStatus === 0 ? 'idle' : 'busy',
    }),
  );
}

/**
 * Check if a USB printer is available in the OS.
 */
export function pingUsbPrinter(printerName: string): boolean {
  try {
    const list = listUsbPrinters();
    return list.some((p) => p.name === printerName);
  } catch {
    return false;
  }
}

/**
 * Send raw ESC/POS data to a local printer by OS name.
 */
export function sendToUsbPrinter(
  printerName: string,
  data: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpFile = path.join(
      tmpdir(),
      `yako-print-${Date.now()}.bin`,
    );

    try {
      writeFileSync(tmpFile, data);

      if (platform === 'darwin' || platform === 'linux') {
        execSync(`lp -d "${printerName}" -o raw "${tmpFile}"`, {
          timeout: 10000,
        });
      } else if (platform === 'win32') {
        execSync(
          `powershell -Command "Copy-Item '${tmpFile}' -Destination '\\\\localhost\\${printerName}' -Force"`,
          { timeout: 10000 },
        );
      } else {
        throw new Error(`Plataforma no soportada: ${platform}`);
      }

      resolve();
    } catch (err) {
      reject(
        new Error(
          `Error al imprimir en ${printerName}: ${err instanceof Error ? err.message : err}`,
        ),
      );
    } finally {
      try {
        unlinkSync(tmpFile);
      } catch {
        /* ignore cleanup errors */
      }
    }
  });
}
