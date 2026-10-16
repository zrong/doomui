import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import type {
  CompleteCocosAdoptionInput,
  CompleteSharedAssetCatalogInput,
  CocosSyncStatusResponse,
  FigmaPushPayload,
  PushPrepareResult,
  PushServiceEvent,
  PushServiceStatus,
  ReleaseCocosAdoptionBindingInput,
} from '../types';
import type { SyncService } from './sync-service';
import { AdoptionService } from './adoption-service';
import { SharedAssetCatalogService } from './shared-asset-catalog-service';

export const PUSH_HOST = '127.0.0.1';
export const PUSH_PORT = 38638;
export const PUSH_ENDPOINT = `http://${PUSH_HOST}:${PUSH_PORT}`;
export const SYNC_PROTOCOL_VERSION = 12;
export const SYNC_SERVICE_ID = 'cocos-sync';

const JSON_BODY_LIMIT = 32 * 1024 * 1024;
const ASSET_BODY_LIMIT = 32 * 1024 * 1024;

function newPairingCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

function newSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { statusCode: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const body = await readBody(request, JSON_BODY_LIMIT);
  try {
    return JSON.parse(body.toString('utf8')) as T;
  } catch {
    throw Object.assign(new Error('请求 JSON 格式无效'), { statusCode: 400 });
  }
}

function setCors(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  response.setHeader('Access-Control-Max-Age', '600');
  response.setHeader('Cache-Control', 'no-store');
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  setCors(response);
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LocalPushServer {
  private server?: Server;
  private pairingCode = newPairingCode();
  private readonly tokens = new Set<string>();
  private readonly confirmedTokens = new Set<string>();
  private error?: string;
  private lastPush?: PushServiceStatus['lastPush'];
  private readonly host: string;
  private readonly port: number;

  constructor(
    private readonly sync: SyncService,
    private readonly emit: (event: PushServiceEvent) => void = () => {},
    options: { host?: string; port?: number } = {},
    private readonly adoptions: AdoptionService = new AdoptionService(),
    private readonly sharedAssets: SharedAssetCatalogService = new SharedAssetCatalogService(),
  ) {
    this.host = options.host ?? PUSH_HOST;
    this.port = options.port ?? PUSH_PORT;
    this.adoptions.setOnChange(() => this.emitStatus());
    this.sharedAssets.setOnChange(() => this.emitStatus());
  }

  private endpoint(): string {
    const address = this.server?.address();
    const port = address && typeof address === 'object' ? address.port : this.port;
    return `http://${this.host}:${port}`;
  }

  async start(): Promise<void> {
    if (this.server?.listening) return;
    this.error = undefined;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.off('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.port, this.host);
    }).catch((error) => {
      this.error = `无法启动 Cocos Sync 本机服务：${errorMessage(error)}`;
      this.server = undefined;
    });
    this.emitStatus();
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.tokens.clear();
    this.confirmedTokens.clear();
    if (server?.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  resetPairing(): PushServiceStatus {
    this.tokens.clear();
    this.confirmedTokens.clear();
    this.pairingCode = newPairingCode();
    this.emitStatus();
    return this.getStatus();
  }

  getStatus(): PushServiceStatus {
    return {
      running: Boolean(this.server?.listening),
      endpoint: this.endpoint(),
      pairingCode: this.pairingCode,
      paired: this.confirmedTokens.size > 0,
      error: this.error,
      lastPush: this.lastPush,
      activeAdoption: this.adoptions.getActiveSummary(),
      activeSharedAssets: this.sharedAssets.getActiveSummary(),
    };
  }

  private emitStatus(): void {
    this.emit({ type: 'status', status: this.getStatus() });
  }

  private authorizedToken(request: IncomingMessage): string | undefined {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    return token && [...this.tokens].find((candidate) => safeEqual(candidate, token));
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    setCors(response);
    if (request.method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }
    try {
      const url = new URL(request.url ?? '/', this.endpoint());
      if (request.method === 'GET' && url.pathname === '/v1/protocol') {
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, service: SYNC_SERVICE_ID });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/pair') {
        const body = await readJson<{ code?: string; protocolVersion?: number }>(request);
        if (body.protocolVersion !== SYNC_PROTOCOL_VERSION) {
          sendJson(response, 409, {
            error: `Cocos Sync 协议版本不兼容：客户端 ${String(body.protocolVersion ?? '未提供')}，服务 ${SYNC_PROTOCOL_VERSION}`,
          });
          return;
        }
        if (!body.code || !safeEqual(body.code.trim().toUpperCase(), this.pairingCode)) {
          sendJson(response, 401, { error: '配对码不正确' });
          return;
        }
        const token = newSessionToken();
        this.tokens.add(token);
        this.pairingCode = newPairingCode();
        this.emitStatus();
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, token, endpoint: this.endpoint() });
        return;
      }

      const token = this.authorizedToken(request);
      if (!token) {
        sendJson(response, 401, { error: '尚未与 Cocos Sync 配对' });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/disconnect') {
        this.tokens.delete(token);
        this.confirmedTokens.delete(token);
        this.emitStatus();
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, disconnected: true });
        return;
      }

      if (!this.confirmedTokens.has(token)) {
        this.confirmedTokens.add(token);
        this.emitStatus();
      }

      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const status = {
          protocolVersion: SYNC_PROTOCOL_VERSION,
          running: true,
          endpoint: this.endpoint(),
          activeAdoption: this.adoptions.getActiveSummary() ?? null,
          activeSharedAssets: this.sharedAssets.getActiveSummary() ?? null,
        } satisfies CocosSyncStatusResponse;
        sendJson(response, 200, status);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/v1/adoptions/bindings') {
        const fileKey = url.searchParams.get('fileKey') ?? '';
        const bindings = await this.adoptions.listBindings(fileKey);
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, bindings });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/adoptions/bindings/release') {
        const body = await readJson<ReleaseCocosAdoptionBindingInput>(request);
        const released = await this.adoptions.releaseBinding(body);
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, released });
        return;
      }

      const adoptionAssetMatch = url.pathname.match(/^\/v1\/adoptions\/([^/]+)\/assets\/([^/]+)$/);
      if (request.method === 'GET' && adoptionAssetMatch) {
        const sessionId = decodeURIComponent(adoptionAssetMatch[1]);
        const key = decodeURIComponent(adoptionAssetMatch[2]);
        const buffer = this.adoptions.getAsset(sessionId, key);
        setCors(response);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Content-Length', buffer.length);
        response.end(buffer);
        return;
      }

      const adoptionCompleteMatch = url.pathname.match(/^\/v1\/adoptions\/([^/]+)\/complete$/);
      if (request.method === 'POST' && adoptionCompleteMatch) {
        const sessionId = decodeURIComponent(adoptionCompleteMatch[1]);
        const body = await readJson<CompleteCocosAdoptionInput>(request);
        const adoption = await this.adoptions.complete(sessionId, body);
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, adoption });
        return;
      }

      const adoptionMatch = url.pathname.match(/^\/v1\/adoptions\/([^/]+)$/);
      if (request.method === 'GET' && adoptionMatch) {
        const sessionId = decodeURIComponent(adoptionMatch[1]);
        sendJson(response, 200, this.adoptions.getDocument(sessionId));
        return;
      }

      const sharedAssetMatch = url.pathname.match(/^\/v1\/shared-assets\/([^/]+)\/assets\/([^/]+)$/);
      if (request.method === 'GET' && sharedAssetMatch) {
        const sessionId = decodeURIComponent(sharedAssetMatch[1]);
        const key = decodeURIComponent(sharedAssetMatch[2]);
        const buffer = this.sharedAssets.getAsset(sessionId, key);
        setCors(response);
        response.statusCode = 200;
        response.setHeader('Content-Type', 'image/png');
        response.setHeader('Content-Length', buffer.length);
        response.end(buffer);
        return;
      }

      const sharedCompleteMatch = url.pathname.match(/^\/v1\/shared-assets\/([^/]+)\/complete$/);
      if (request.method === 'POST' && sharedCompleteMatch) {
        const sessionId = decodeURIComponent(sharedCompleteMatch[1]);
        const body = await readJson<CompleteSharedAssetCatalogInput>(request);
        const sharedAssets = await this.sharedAssets.complete(sessionId, body);
        sendJson(response, 200, { protocolVersion: SYNC_PROTOCOL_VERSION, sharedAssets });
        return;
      }

      const sharedMatch = url.pathname.match(/^\/v1\/shared-assets\/([^/]+)$/);
      if (request.method === 'GET' && sharedMatch) {
        const sessionId = decodeURIComponent(sharedMatch[1]);
        sendJson(response, 200, this.sharedAssets.getDocument(sessionId));
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/prepare') {
        const payload = await readJson<FigmaPushPayload>(request);
        const result = await this.sync.previewPush(payload);
        const names = payload.targets.map((target) => target.document.name);
        const targetLabel = names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 项`;
        this.lastPush = {
          targetLabel,
          receivedAt: new Date().toISOString(),
          planId: result.preview.planId,
        };
        if (!result.requiresComplete) {
          this.emit({ type: 'preview', status: this.getStatus(), preview: result.preview, targetLabel });
        } else {
          this.emitStatus();
        }
        sendJson(response, 200, result satisfies PushPrepareResult);
        return;
      }

      const assetMatch = url.pathname.match(/^\/v1\/assets\/([^/]+)\/([^/]+)$/);
      if (request.method === 'PUT' && assetMatch) {
        const planId = decodeURIComponent(assetMatch[1]);
        const key = decodeURIComponent(assetMatch[2]);
        const buffer = await readBody(request, ASSET_BODY_LIMIT);
        this.sync.receivePushAsset(planId, key, buffer);
        sendJson(response, 200, { received: buffer.length });
        return;
      }

      if (request.method === 'POST' && url.pathname === '/v1/complete') {
        const body = await readJson<{ planId?: string }>(request);
        if (!body.planId) throw Object.assign(new Error('缺少 planId'), { statusCode: 400 });
        const preview = this.sync.completePush(body.planId);
        const targetLabel = this.lastPush?.targetLabel ?? '所选内容';
        this.emit({ type: 'preview', status: this.getStatus(), preview, targetLabel });
        sendJson(response, 200, { preview });
        return;
      }

      sendJson(response, 404, { error: '接口不存在' });
    } catch (error) {
      const message = errorMessage(error);
      const statusCode = Number((error as { statusCode?: number })?.statusCode) || 400;
      if (this.lastPush) this.lastPush = { ...this.lastPush, error: message };
      this.emit({ type: 'error', status: this.getStatus(), message });
      sendJson(response, statusCode, { error: message });
    }
  }
}
