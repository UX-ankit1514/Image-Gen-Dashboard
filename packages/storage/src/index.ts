/**
 * Object storage (PRD §53): one S3-compatible client for the Worker and the Functions, pointed at
 * Cloudflare R2 in production and MinIO in development. The folder layout is storage only; the
 * project's source of truth is Firestore.
 *
 *   ws/<workspace>/project/<project>/{source,uploaded,generated,previews,exports}/<file>
 *   ws/<workspace>/global/<file>
 */
import { AwsClient } from 'aws4fetch';

export interface StorageConfig {
  endpoint: string;       // https://<account>.r2.cloudflarestorage.com  |  http://127.0.0.1:9000
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;        // 'auto' for R2
  /** Base used in presigned URLs handed to browsers, when it differs from `endpoint`. */
  publicEndpoint?: string;
}

export type Folder = 'source' | 'uploaded' | 'generated' | 'previews' | 'exports' | 'references';

export function projectKey(ws: string, project: string, folder: Folder, file: string) {
  return `ws/${ws}/project/${project}/${folder}/${file}`;
}

export function globalKey(ws: string, file: string) {
  return `ws/${ws}/global/${file}`;
}

export function variantKey(key: string, variant: 'thumb' | 'preview', ext: string) {
  return key.replace(/\.[a-z0-9]+$/i, '') + `.${variant}.${ext}`;
}

export class Storage {
  private aws: AwsClient;

  constructor(private cfg: StorageConfig) {
    this.aws = new AwsClient({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      service: 's3',
      region: cfg.region || 'auto',
    });
  }

  private url(key: string, base = this.cfg.endpoint) {
    const enc = key.split('/').map(encodeURIComponent).join('/');
    return `${base.replace(/\/$/, '')}/${this.cfg.bucket}/${enc}`;
  }

  async put(key: string, body: ArrayBuffer | Uint8Array | ReadableStream | string, contentType: string, extra: Record<string, string> = {}) {
    const res = await this.aws.fetch(this.url(key), {
      method: 'PUT',
      body: body as BodyInit,
      headers: { 'content-type': contentType, ...extra },
    });
    if (!res.ok) throw new Error(`storage put ${key}: ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  }

  async get(key: string): Promise<Response> {
    const res = await this.aws.fetch(this.url(key), { method: 'GET' });
    if (!res.ok) throw new Error(`storage get ${key}: ${res.status}`);
    return res;
  }

  async getBytes(key: string) {
    return new Uint8Array(await (await this.get(key)).arrayBuffer());
  }

  async exists(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'HEAD' });
    return res.ok;
  }

  async delete(key: string) {
    const res = await this.aws.fetch(this.url(key), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`storage delete ${key}: ${res.status}`);
  }

  /**
   * A presigned GET URL. Expiry is rounded to a window boundary so the same key yields the same
   * URL for a while — browsers can then cache thumbnails instead of refetching on every poll.
   */
  async signedUrl(key: string, ttlSeconds = 6 * 3600, filename?: string) {
    const windowS = Math.max(300, Math.floor(ttlSeconds / 2));
    const nowS = Math.floor(Date.now() / 1000);
    const windowStart = nowS - (nowS % windowS);
    // relative to X-Amz-Date (= windowStart): valid until windowStart + ttl + window ≥ now + ttl
    const u = new URL(this.url(key, this.cfg.publicEndpoint || this.cfg.endpoint));
    u.searchParams.set('X-Amz-Expires', String(Math.min(604800, ttlSeconds + windowS)));
    if (filename) u.searchParams.set('response-content-disposition', `attachment; filename="${filename.replace(/"/g, '')}"`);
    const signed = await this.aws.sign(u.toString(), {
      method: 'GET',
      aws: { signQuery: true, datetime: new Date(windowStart * 1000).toISOString().replace(/[:-]|\.\d{3}/g, '') },
    });
    return signed.url;
  }

  /** Development only: create the bucket if MinIO doesn't have it yet. */
  async ensureBucket() {
    const res = await this.aws.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}`, { method: 'HEAD' });
    if (res.ok) return false;
    const made = await this.aws.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}`, { method: 'PUT' });
    if (!made.ok && made.status !== 409) throw new Error(`create bucket: ${made.status} ${await made.text()}`);
    return true;
  }
}
