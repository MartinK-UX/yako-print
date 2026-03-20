/**
 * Builds a simple ESC/POS test ticket to verify printer connectivity.
 */

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = Buffer.from([ESC, 0x40]);
const CUT = Buffer.from([GS, 0x56, 0x00]);
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const DOUBLE_HEIGHT_ON = Buffer.from([GS, 0x21, 0x01]);
const DOUBLE_HEIGHT_OFF = Buffer.from([GS, 0x21, 0x00]);
const FEED_LINES = (n: number) => Buffer.from([ESC, 0x64, n]);

function line(str: string): Buffer {
  return Buffer.concat([Buffer.from(str, 'utf-8'), Buffer.from([LF])]);
}

function divider(cols: number): Buffer {
  return line('-'.repeat(cols));
}

export function buildTestTicket(
  paperWidth: 58 | 80,
  businessName?: string,
): Buffer {
  const cols = paperWidth === 58 ? 32 : 48;
  const parts: Buffer[] = [];
  const now = new Date().toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  parts.push(INIT);

  parts.push(ALIGN_CENTER);
  parts.push(BOLD_ON);
  parts.push(DOUBLE_HEIGHT_ON);
  parts.push(line(businessName || 'Yako POS'));
  parts.push(DOUBLE_HEIGHT_OFF);
  parts.push(BOLD_OFF);

  parts.push(line(''));
  parts.push(line('TICKET DE PRUEBA'));
  parts.push(line(''));

  parts.push(divider(cols));

  parts.push(ALIGN_LEFT);
  parts.push(line(`Fecha: ${now}`));
  parts.push(line(`Papel: ${paperWidth}mm (${cols} cols)`));

  parts.push(divider(cols));

  parts.push(ALIGN_CENTER);
  parts.push(line(''));
  parts.push(BOLD_ON);
  parts.push(line('Impresora configurada'));
  parts.push(line('correctamente'));
  parts.push(BOLD_OFF);
  parts.push(line(''));

  parts.push(divider(cols));

  parts.push(line('ABCDEFGHIJKLMNOPQRSTUVWXYZabcde'));
  parts.push(line('0123456789 $,.:-+()/#@!%'));

  parts.push(divider(cols));

  parts.push(line(''));
  parts.push(line('Powered by Yako'));
  parts.push(line(''));

  parts.push(ALIGN_LEFT);
  parts.push(FEED_LINES(4));
  parts.push(CUT);

  return Buffer.concat(parts);
}
