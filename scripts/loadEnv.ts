// Centralised env loader for our scripts.
// Loads .env.local first (our preferred file), then .env as a fallback.
import { config } from 'dotenv';
import { existsSync } from 'node:fs';

const candidates = ['.env.local', '.env'];
for (const file of candidates) {
  if (existsSync(file)) {
    config({ path: file, override: false });
  }
}
