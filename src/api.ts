import https from 'https';
import http from 'http';
import { URL } from 'url';

// ── Types ────────────────────────────────────────────────────────

export interface PrintJobPrinter {
  id: string;
  name: string;
  connectionType: 'network' | 'usb';
  ip: string;
  port: number;
  usbName: string;
  paperWidth: 58 | 80;
}

export interface PrintJob {
  id: string;
  tenantId: string;
  printerId: string;
  type: string;
  payload: string;
  status: string;
  orderId: string;
  createdAt: string;
  printer: PrintJobPrinter;
}

export interface RegisterResponse {
  id: string;
  apiKey: string;
  name: string;
  tenantId: string;
}

// ── API Error ────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Client ───────────────────────────────────────────────────────

const REQUEST_TIMEOUT = 10_000;

export class ApiClient {
  private apiKey?: string;

  constructor(private baseUrl: string) {}

  setApiKey(key: string) {
    this.apiKey = key;
  }

  async register(
    name: string,
    machineId: string,
    registrationToken: string,
  ): Promise<RegisterResponse> {
    const res = await this.request('POST', '/api/print-agent/register', {
      name,
      machineId,
      registrationToken,
    });
    if (!res.success) throw new Error(res.error || 'Registration failed');
    return res.data;
  }

  async getPendingJobs(): Promise<PrintJob[]> {
    const res = await this.request('GET', '/api/print-jobs/pending');
    if (!res.success) throw new Error(res.error || 'Failed to fetch jobs');
    return res.data ?? [];
  }

  async updateJobStatus(
    id: string,
    status: string,
    failedReason?: string,
  ): Promise<void> {
    const body: Record<string, string> = { status };
    if (failedReason) body.failedReason = failedReason;
    await this.request('PATCH', `/api/print-jobs/${id}`, body);
  }

  async heartbeat(): Promise<void> {
    await this.request('POST', '/api/print-agent/heartbeat');
  }

  // ── HTTP helper ──

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private request(
    method: string,
    urlPath: string,
    body?: unknown,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlPath, this.baseUrl);
      const mod = url.protocol === 'https:' ? https : http;
      const payload = body ? JSON.stringify(body) : undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) headers['x-agent-api-key'] = this.apiKey;
      if (payload)
        headers['Content-Length'] = String(Buffer.byteLength(payload));

      const req = mod.request(url, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            const json = JSON.parse(text);
            if (res.statusCode && res.statusCode >= 400) {
              reject(
                new ApiError(
                  json.error || `HTTP ${res.statusCode}`,
                  res.statusCode,
                ),
              );
            } else {
              resolve(json);
            }
          } catch {
            reject(new Error(`Invalid JSON: ${text.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(REQUEST_TIMEOUT, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (payload) req.write(payload);
      req.end();
    });
  }
}
