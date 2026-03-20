/**
 * ESC/POS command builder for thermal printers.
 * Generates a binary buffer with print commands.
 */

// ── Control codes ────────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

const INIT = Buffer.from([ESC, 0x40]); // Initialize printer
const CUT = Buffer.from([GS, 0x56, 0x00]); // Full cut
const ALIGN_CENTER = Buffer.from([ESC, 0x61, 0x01]);
const ALIGN_LEFT = Buffer.from([ESC, 0x61, 0x00]);
const BOLD_ON = Buffer.from([ESC, 0x45, 0x01]);
const BOLD_OFF = Buffer.from([ESC, 0x45, 0x00]);
const DOUBLE_HEIGHT_ON = Buffer.from([GS, 0x21, 0x01]);
const DOUBLE_HEIGHT_OFF = Buffer.from([GS, 0x21, 0x00]);
const FEED_LINES = (n: number) => Buffer.from([ESC, 0x64, n]);

// ── Types ────────────────────────────────────────────────────────

export interface ReceiptItem {
  quantity: number;
  productName: string;
  priceCents: number;
  variantLabel: string | null;
  modifierLabels: string | null;
  comboName: string | null;
  comboGroupId: string | null;
}

export interface PrintData {
  businessName: string;
  address: string;
  ticketHeader: string;
  ticketFooter: string;
  orderNumber: number;
  date: string;
  consumptionType: string | null;
  clientName: string | null;
  tableName: string | null;
  deliveryAddress: string | null;
  deliveryPhone: string | null;
  comment: string | null;
  paymentMethod: string | null;
  discount: number | null;
  items: ReceiptItem[];
  totalCents: number;
  paperWidth: 58 | 80;
}

// ── Helpers ──────────────────────────────────────────────────────

function formatPrice(cents: number): string {
  const formatted = (cents / 100).toLocaleString('es-AR', {
    minimumFractionDigits: 0,
  });
  return `$ ${formatted}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function consumptionLabel(type: string | null): string {
  switch (type) {
    case 'salon':
      return 'Salon';
    case 'delivery':
      return 'Delivery';
    case 'takeaway':
      return 'Take away';
    default:
      return '';
  }
}

function text(str: string): Buffer {
  return Buffer.from(str, 'utf-8');
}

function line(str: string): Buffer {
  return Buffer.concat([text(str), Buffer.from([LF])]);
}

function divider(cols: number): Buffer {
  return line('-'.repeat(cols));
}

/** Right-pad `left`, right-align `right` within `cols` characters */
function row(left: string, right: string, cols: number): Buffer {
  const gap = cols - left.length - right.length;
  if (gap < 1) {
    return line(left.slice(0, cols - right.length - 1) + ' ' + right);
  }
  return line(left + ' '.repeat(gap) + right);
}

function parseModifiers(raw: string | null): string[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// ── Builder ──────────────────────────────────────────────────────

export function buildEscPos(data: PrintData): Buffer {
  const cols = data.paperWidth === 58 ? 32 : 48;
  const parts: Buffer[] = [];

  parts.push(INIT);

  // ── Header ──
  parts.push(ALIGN_CENTER);
  parts.push(BOLD_ON);
  parts.push(line(data.businessName));
  parts.push(BOLD_OFF);
  if (data.address) parts.push(line(data.address));
  if (data.ticketHeader) parts.push(line(data.ticketHeader));
  parts.push(ALIGN_LEFT);

  parts.push(divider(cols));

  // ── Order info ──
  parts.push(BOLD_ON);
  parts.push(line(`Pedido #${data.orderNumber}`));
  parts.push(BOLD_OFF);
  parts.push(line(formatDate(data.date)));

  const cType = consumptionLabel(data.consumptionType);
  if (cType) parts.push(line(cType));
  if (data.tableName) parts.push(line(`Mesa: ${data.tableName}`));
  if (data.clientName) parts.push(line(`Cliente: ${data.clientName}`));
  if (data.deliveryAddress) parts.push(line(`Dir: ${data.deliveryAddress}`));
  if (data.deliveryPhone) parts.push(line(`Tel: ${data.deliveryPhone}`));
  if (data.comment) parts.push(line(`Nota: ${data.comment}`));

  parts.push(divider(cols));

  // ── Items ──
  const seenCombos = new Set<string>();

  for (const item of data.items) {
    if (item.comboGroupId) {
      if (seenCombos.has(item.comboGroupId)) continue;
      seenCombos.add(item.comboGroupId);

      const components = data.items.filter(
        (i) => i.comboGroupId === item.comboGroupId,
      );
      const total = components.reduce(
        (s, i) => s + i.priceCents * i.quantity,
        0,
      );

      parts.push(BOLD_ON);
      parts.push(row(item.comboName ?? 'Combo', formatPrice(total), cols));
      parts.push(BOLD_OFF);

      for (const comp of components) {
        parts.push(line(`  ${comp.quantity}x ${comp.productName}`));
        const subtitle = buildSubtitle(comp);
        if (subtitle) parts.push(line(`    ${subtitle}`));
      }
    } else {
      parts.push(
        row(
          `${item.quantity}x ${item.productName}`,
          formatPrice(item.priceCents * item.quantity),
          cols,
        ),
      );
      const subtitle = buildSubtitle(item);
      if (subtitle) parts.push(line(`  ${subtitle}`));
    }
  }

  parts.push(divider(cols));

  // ── Totals ──
  const subtotalCents = data.totalCents;
  let finalTotal = subtotalCents;

  if (data.discount && data.discount > 0) {
    const discountAmount = Math.round(
      (subtotalCents * data.discount) / 100,
    );
    finalTotal = subtotalCents - discountAmount;
    parts.push(row('Subtotal', formatPrice(subtotalCents), cols));
    parts.push(
      row(`Descuento ${data.discount}%`, `-${formatPrice(discountAmount)}`, cols),
    );
    parts.push(divider(cols));
  }

  parts.push(BOLD_ON);
  parts.push(DOUBLE_HEIGHT_ON);
  parts.push(row('TOTAL', formatPrice(finalTotal), cols));
  parts.push(DOUBLE_HEIGHT_OFF);
  parts.push(BOLD_OFF);

  if (data.paymentMethod) {
    parts.push(line(`Pago: ${data.paymentMethod}`));
  }

  // ── Footer ──
  parts.push(divider(cols));
  parts.push(ALIGN_CENTER);
  parts.push(line(data.ticketFooter || 'Gracias por su compra!'));
  parts.push(ALIGN_LEFT);

  // Feed and cut
  parts.push(FEED_LINES(4));
  parts.push(CUT);

  return Buffer.concat(parts);
}

function buildSubtitle(item: ReceiptItem): string {
  const parts: string[] = [];
  if (item.variantLabel) parts.push(item.variantLabel);
  const mods = parseModifiers(item.modifierLabels);
  parts.push(...mods);
  return parts.join(' / ');
}
