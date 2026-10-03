import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { randomUUID } from 'node:crypto';
import { createStore } from './store.js';
import { createWechatClient } from './wechat.js';
import { ApiError } from './errors.js';
import { loginBody, saveBody, importBody, consumeBody } from './schemas.js';

export async function buildApp({ config, pool, store = createStore(pool, config), wechat = createWechatClient(config), logger = true }) {
  const app = Fastify({
    bodyLimit: 65536,
    requestTimeout: 15000,
    connectionTimeout: 10000,
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, useDefaults: false } },
    genReqId: () => randomUUID(),
    logger: logger === false ? false : {
      level: config.logLevel,
      redact: ['req.headers.authorization', '*.token', '*.appSecret', '*.session_key', '*.code'],
      serializers: { req: request => ({ id: request.id, method: request.method, path: request.url.split('?')[0], remoteAddress: request.ip }) }
    }
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    errorResponseBuilder: () => new ApiError(429, 'RATE_LIMITED', '请求过于频繁，请稍后重试')
  });
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); });
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: '请求格式不正确', fields: error.validation.map(item => ({ path: item.instancePath, rule: item.keyword })) }, requestId: request.id });
    if (error instanceof ApiError) {
      request.log.warn({ code: error.code, details: error.details }, error.message);
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, ...error.details }, requestId: request.id });
    }
    if (error.statusCode === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后重试' }, requestId: request.id });
    if (error.statusCode === 413) return reply.code(413).send({ error: { code: 'REQUEST_TOO_LARGE', message: '请求超过大小限制' }, requestId: request.id });
    if (error.statusCode === 400) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: '请求 JSON 无效' }, requestId: request.id });
    request.log.error({ err: error }, 'Backend request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务处理失败，请提供请求编号以便排查' }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' }, requestId: request.id }));

  app.get('/health/live', async () => ({ status: 'alive' }));
  app.get('/health/ready', async (request, reply) => {
    const wechatStatus = config.appId && config.appSecret ? 'configured' : 'pending_configuration';
    try { await store.health(); }
    catch (error) {
      request.log.error({ err: error }, 'Database readiness failed');
      return reply.code(503).send({ status: 'not_ready', database: 'unavailable', wechat: wechatStatus, payment: 'not_enabled', advertising: 'not_enabled', requestId: request.id });
    }
    return { status: 'ready', database: 'ready', wechat: wechatStatus, payment: 'not_enabled', advertising: 'not_enabled' };
  });
  app.post('/v1/auth/wechat', { schema: { body: loginBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async request => {
    const identity = await wechat.exchangeCode(request.body.code);
    const session = await store.createSession(identity.openid);
    request.log.info({ userId: session.account.user.id, action: 'login' }, 'WeChat login succeeded');
    return session;
  });

  async function authenticate(request) {
    const authorization = request.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHORIZED', '请先微信登录');
    request.userId = await store.authenticate(authorization.slice(7));
  }
  app.get('/v1/me', { preHandler: authenticate }, async request => store.getAccount(request.userId));
  app.put('/v1/me/save', { preHandler: authenticate, schema: { body: saveBody } }, async request => {
    const response = await store.save(request.userId, request.body);
    request.log.info({ userId: request.userId, mutationId: request.body.mutationId, revision: response.account.revision, runId: request.body.run.id, stage: request.body.run.stage, runStatus: request.body.run.status, stageResults: request.body.stageResults.map(item => item.stage) }, 'Cloud save committed');
    return response;
  });
  app.post('/v1/me/import', { preHandler: authenticate, schema: { body: importBody } }, async request => {
    const response = await store.importSave(request.userId, request.body);
    request.log.info({ userId: request.userId, mutationId: request.body.mutationId, revision: response.account.revision }, 'Local save imported once');
    return response;
  });
  app.post('/v1/inventory/consume', { preHandler: authenticate, schema: { body: consumeBody } }, async request => {
    const response = await store.consume(request.userId, request.body);
    request.log.info({ userId: request.userId, mutationId: request.body.mutationId, item: request.body.item, balance: response.inventory[request.body.item] }, 'Inventory consumed');
    return response;
  });
  return app;
}
