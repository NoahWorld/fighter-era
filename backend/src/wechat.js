import { ApiError } from './errors.js';

export function createWechatClient(config, fetchImpl = fetch) {
  return {
    async exchangeCode(code) {
      if (!config.appId || !config.appSecret) {
        throw new ApiError(503, 'WECHAT_NOT_CONFIGURED', '微信登录待配置 AppSecret');
      }
      const endpoint = new URL('https://api.weixin.qq.com/sns/jscode2session');
      endpoint.searchParams.set('appid', config.appId);
      endpoint.searchParams.set('secret', config.appSecret);
      endpoint.searchParams.set('js_code', code);
      endpoint.searchParams.set('grant_type', 'authorization_code');
      let response;
      try {
        response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(8000), redirect: 'error' });
      } catch (cause) {
        // Fetch exceptions can contain the complete credential-bearing URL: never log or expose them.
        throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务请求失败', { upstreamFailure: cause.name === 'TimeoutError' ? 'timeout' : 'network' });
      }
      if (!response.ok) throw new ApiError(502, 'WECHAT_UNAVAILABLE', '微信登录服务返回异常', { upstreamStatus: response.status });
      let body;
      try {
        body = await response.json();
      } catch {
        throw new ApiError(502, 'WECHAT_INVALID_RESPONSE', '微信登录服务返回了无效 JSON');
      }
      if (body.errcode) {
        const rejected = [40029, 40163].includes(body.errcode);
        throw new ApiError(rejected ? 401 : 502, rejected ? 'WECHAT_CODE_REJECTED' : 'WECHAT_UNAVAILABLE', rejected ? '微信登录凭证已失效，请重新登录' : '微信登录失败', { upstreamCode: body.errcode });
      }
      if (typeof body.openid !== 'string' || body.openid.length < 1 || body.openid.length > 128 || typeof body.session_key !== 'string' || !body.session_key) {
        throw new ApiError(502, 'WECHAT_INVALID_RESPONSE', '微信登录服务缺少身份信息');
      }
      // Identity is all this application needs. session_key is neither persisted nor returned to clients.
      return { openid: body.openid };
    }
  };
}
