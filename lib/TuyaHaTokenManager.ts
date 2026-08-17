import crypto from 'crypto';
import type Homey from 'homey/lib/Homey.js';
import { fetch } from 'homey-oauth2app';
import type TuyaHaClient from './TuyaHaClient.js';
import TuyaHaToken from './TuyaHaToken.js';
import * as TuyaOAuth2Util from './TuyaOAuth2Util.js';
import { getTuyaClientId } from './TuyaHaClientId.js';
import TuyaOAuth2Error from './TuyaOAuth2Error.js';
import type { TuyaHasResponse, TuyaTokenRefreshResponse } from '../types/TuyaHaApiTypes.js';

// Backoff times in seconds
const TOKEN_REFRESH_INTERVAL = 30;
const TOKEN_REFRESH_BACK_OFF: Record<number, number> = {
  1: 31,
  2: 61,
  3: 121,
  4: 241,
  5: 481,
};

export default class TuyaHaTokenManager {
  private tokenRefreshPromise: Promise<void> | null = null;

  private autoTokenRefreshEnabled = true;
  private autoTokenRefreshFailedCount = 0;
  private autoTokenRefreshBackOff = 0;
  private lastTokenSave = 0; // This default will ensure an automated refresh 30 seconds after app start
  private tokenExpireTime = 7200; // 2 hours in seconds
  private readonly randomRefreshOffset = Math.round(Math.random() * 900) + 300; // Randomise the time the app tries to start its automated refresh
  private readonly homey: Homey;
  private readonly tokenRefresher: NodeJS.Timeout;

  public constructor(private readonly client: TuyaHaClient) {
    this.homey = client.homey;
    // Automatic token refresher as this app relies on MQTT data, which doesn't refresh the token automatically
    this.tokenRefresher = this.homey.setInterval(() => this.refreshApiToken(), TOKEN_REFRESH_INTERVAL * 1000);
  }

  public stopTokenRefresher(): void {
    this.homey.clearInterval(this.tokenRefresher);
  }

  public getHeaders(
    method: string,
    path: string,
    query?: object,
    json?: object,
  ): {
    requestUrl: URL;
    requestOptions: {
      method: string;
      headers: Record<string, string>;
      body: string | undefined;
    };
    secret: string;
  } {
    const token = this.client.getToken();
    if (!token) {
      throw new TuyaOAuth2Error(this.homey.__('error_no_token'));
    }

    const requestUrl = new URL(`${token.endpoint}${path}`);
    const requestOptions = {
      method,
      headers: {} as Record<string, string>,
      body: undefined as string | undefined,
    };

    const rid = crypto.randomUUID();
    const sid = '';
    const hashKey = crypto.createHash('md5').update(`${rid}${token.refresh_token}`).digest('hex');
    const secret = TuyaOAuth2Util.secretGenerating(rid, sid, hashKey);

    let queryEncdata = '';
    if (query && Object.keys(query).length > 0) {
      queryEncdata = JSON.stringify(query);
      queryEncdata = TuyaOAuth2Util.aesGcmEncrypt(queryEncdata, secret);
      requestUrl.searchParams.append('encdata', queryEncdata);
    }

    let bodyEncdata = '';
    if (json && Object.keys(json).length > 0) {
      bodyEncdata = JSON.stringify(json);
      bodyEncdata = TuyaOAuth2Util.aesGcmEncrypt(bodyEncdata, secret);
      requestOptions.body = JSON.stringify({ encdata: bodyEncdata });
    }

    const t = Date.now();
    const requestHeaders = {
      'X-appKey': getTuyaClientId(),
      'X-requestId': rid,
      'X-sid': sid,
      'X-time': `${t}`,
      'X-token': token.access_token,
    };

    requestOptions.headers = {
      ...requestHeaders,
      'X-sign': TuyaOAuth2Util.restfulSign(hashKey, queryEncdata, bodyEncdata, requestHeaders),
      'Content-Type': 'application/json',
    };

    return { requestUrl, requestOptions, secret };
  }

  private async executeTokenRefresh(): Promise<void> {
    try {
      this.log('Refreshing token...');
      const token = this.client.getToken();
      if (!token) {
        return;
      }

      const { requestUrl, requestOptions, secret } = this.getHeaders('GET', `/v1.0/m/token/${token.refresh_token}`);

      const response = await fetch(requestUrl.toString(), requestOptions);
      const responseBodyJson = (await response.json()) as TuyaHasResponse<string>;

      if (!responseBodyJson.success) {
        const code = responseBodyJson.code !== undefined ? parseInt(responseBodyJson.code) : undefined;
        this.error('Token refresh failed', responseBodyJson);
        throw new TuyaOAuth2Error(this.homey.__('error_refreshing_token_access'), response.status, code);
      }

      if (responseBodyJson.result === undefined) {
        throw new Error('Token refresh response result is undefined');
      }

      const responseBodyDecrypted = TuyaOAuth2Util.aesGcmDecrypt(responseBodyJson.result, secret);
      const res = JSON.parse(responseBodyDecrypted) as TuyaTokenRefreshResponse;

      const newToken = new TuyaHaToken({
        ...token.toJSON(),
        uid: res.uid ?? token.uid,
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
        expire_time: res.expireTime ?? token.expire_time,
      });

      this.client.setToken({ token: newToken });
      this.log('Refreshed token');

      // Save the token to the app store
      this.client.save();

      // Store last token save and expire time for automated refresh
      this.lastTokenSave = Date.now();
      this.tokenExpireTime = newToken.expire_time ?? 7200;

      // Wait a little bit to give the refresh token time to propagate
      await new Promise(resolve => this.homey.setTimeout(resolve, 2000));
    } finally {
      this.tokenRefreshPromise = null;
    }
  }

  public refreshApiToken(): void {
    const now = Date.now();
    if (now - this.lastTokenSave < (this.tokenExpireTime - this.randomRefreshOffset) * 1000) {
      // No need to refresh
      return;
    }

    if (!this.client.getToken()) {
      // No token? No automatic refresh!
      return;
    }

    if (!this.autoTokenRefreshEnabled) {
      return;
    }

    if (now <= this.autoTokenRefreshBackOff) {
      this.log('Automatic token refresh backoff in effect', new Date(this.autoTokenRefreshBackOff).toISOString());
      return;
    }

    if (this.tokenRefreshPromise) {
      // Refresh already in progress
      return;
    }

    this.log('Automatic token refresh');
    this.tokenRefreshPromise = this.executeTokenRefresh()
      .then(() => {
        this.debug('Automatic token refresh succeeded');
        this.autoTokenRefreshFailedCount = 0;
        this.client.emit('token_error', false);
      })
      .catch(e => {
        this.autoTokenRefreshFailedCount++;
        this.debug('Automatic token refresh failed', this.autoTokenRefreshFailedCount, e);
        const backoff = TOKEN_REFRESH_BACK_OFF[this.autoTokenRefreshFailedCount];
        if (backoff) {
          this.autoTokenRefreshBackOff = Date.now() + backoff * 1000;
          this.log('Automatic token refresh backoff set to', new Date(this.autoTokenRefreshBackOff).toISOString());
        } else {
          this.error('Automated refresh disabled due to continued failures');
          this.autoTokenRefreshEnabled = false;
        }
        this.client.emit('token_error', true, e);
      });
  }

  public resetAutoRefresh(): void {
    this.autoTokenRefreshEnabled = true;
    this.autoTokenRefreshFailedCount = 0;
    this.autoTokenRefreshBackOff = 0;
  }

  public async waitForRefresh(): Promise<void> {
    await this.tokenRefreshPromise;
  }

  private log(...args: unknown[]): void {
    this.client.log('[TokenManager]', ...args);
  }

  private error(...args: unknown[]): void {
    this.client.error('[TokenManager]', ...args);
  }

  private debug(...args: unknown[]): void {
    this.client.debug('[TokenManager]', ...args);
  }
}
