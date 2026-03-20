import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import path from 'path';
import os from 'os';

const CERT_DIR = path.join(os.homedir(), '.yako-print');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
export const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

export interface TlsCert {
  key: string;
  cert: string;
}

/**
 * Returns the TLS key and cert for HTTPS.
 * Generates a self-signed certificate if one doesn't exist yet.
 */
export function ensureCert(): TlsCert {
  mkdirSync(CERT_DIR, { recursive: true });

  if (!existsSync(KEY_PATH) || !existsSync(CERT_PATH)) {
    console.log('  Generando certificado HTTPS...');
    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes ` +
        `-keyout "${KEY_PATH}" -out "${CERT_PATH}" ` +
        `-days 3650 -subj "/CN=Yako Print" ` +
        `-addext "subjectAltName=IP:127.0.0.1,IP:0.0.0.0"`,
      { stdio: 'ignore' },
    );
  }

  return {
    key: readFileSync(KEY_PATH, 'utf-8'),
    cert: readFileSync(CERT_PATH, 'utf-8'),
  };
}
