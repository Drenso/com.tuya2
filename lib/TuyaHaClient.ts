import crypto from 'crypto';
import Homey from 'homey';
import { fetch, OAuth2Client } from 'homey-oauth2app';
import mqtt from 'mqtt';
import { nanoid } from 'nanoid';
import { URL } from 'url';
import type {
  TuyaCommand,
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
  TuyaIrRemoteKeysResponse,
  TuyaIrRemoteResponse,
  TuyaStatusResponse,
  TuyaWebRTC,
} from '../types/TuyaApiTypes.js';
import type {
  TuyaHaHome,
  TuyaHaScenesResponse,
  TuyaHasResponse,
  TuyaHaStatusResponse,
  TuyaMqttConfigResponse,
  TuyaMqttMessage,
  TuyaTokenRefreshResponse,
} from '../types/TuyaHaApiTypes.js';
import type { DeviceRegistration } from '../types/TuyaTypes.js';
import { getTuyaClientId } from './TuyaHaClientId.js';
import TuyaHaToken from './TuyaHaToken.js';
import TuyaOAuth2Error from './TuyaOAuth2Error.js';
import * as TuyaOAuth2Util from './TuyaOAuth2Util.js';

type OAuth2SessionInformation = { id: string; title: string };

const noop = (): void => {};

export default class TuyaHaClient extends OAuth2Client<TuyaHaToken> {
  protected static TOKEN = TuyaHaToken;
  protected static API_URL = '<dummy>';
  protected static TOKEN_URL = '<dummy>';
  protected static AUTHORIZATION_URL = 'https://openapi.tuyaus.com/login';
  protected static REDIRECT_URL = 'https://tuya.athom.com/callback';

  private mqttPromise?: Promise<void>;
  private mqttConfig?: TuyaMqttConfigResponse;
  private mqttClient?: mqtt.MqttClient;
  private requestingMqttConfig = false;

  private resolveReadyPromise: () => void = noop;
  private readyPromise = new Promise<void>(resolve => {
    this.resolveReadyPromise = resolve;
  });

  private tokenRefreshPromise?: Promise<void>;
  private tokenRefresher?: NodeJS.Timeout;
  private lastTokenSave = 0; // This default will ensure an automated refresh 30 seconds after app start
  private tokenExpireTime = 7200; // 2 hours in seconds

  // We save this information to eventually enable OAUTH2_MULTI_SESSION.
  // We can then list all authenticated users by name, e-mail and country flag.
  // This is useful for multiple account across Tuya brands & regions.
  public async onGetOAuth2SessionInformation(): Promise<OAuth2SessionInformation> {
    const token = this.getToken();
    if (!token) {
      throw new TuyaOAuth2Error(this.homey.__('error_no_token'));
    }

    return {
      id: token.uid,
      title: token.username,
    };
  }

  public async onInit(): Promise<void> {
    this.error = this.error.bind(this);
    this.resolveReadyPromise();

    // Automatic token refresher as this app relies on MQTT data, which doesn't refresh the token automatically
    this.tokenRefresher = this.homey.setInterval(() => this.refreshApiToken(), 30 * 1000);
  }

  public async onUninit(): Promise<void> {
    if (this.tokenRefresher) {
      this.homey.clearInterval(this.tokenRefresher);
    }
  }

  // Sign the request
  private async _executeRequest<T>(
    {
      method,
      path,
      json,
      query = {},
      headers = {},
      isTokenRefresh = false,
    }: {
      method: string;
      path: string;
      json?: object;
      query?: object;
      headers?: object;
      isTokenRefresh?: boolean;
    },
    didRefreshToken = false,
  ): Promise<T> {
    await this.readyPromise;
    if (!isTokenRefresh && !didRefreshToken && this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
    }

    const token = this.getToken();
    if (!token) {
      throw new TuyaOAuth2Error(this.homey.__('error_no_token'));
    }
    this.debug('[executeRequest]', JSON.stringify({ method, path, json, query, headers, token }));

    const requestUrl = new URL(`${token.endpoint}${path}`);
    const requestOptions = {
      method,
      headers,
      body: undefined as string | undefined,
    };

    const t = Date.now(); // Timestamp in milliseconds
    const rid = crypto.randomUUID(); // Request ID
    const sid = ''; // Session ID
    const hashKey = crypto.createHash('md5').update(`${rid}${token.refresh_token}`).digest('hex');
    const secret = TuyaOAuth2Util.secretGenerating(rid, sid, hashKey);

    let queryEncdata = '';
    if (Object.keys(query).length > 0) {
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

    const response = await fetch(requestUrl.toString(), requestOptions);
    const responseBodyJson = (await response.json()) as TuyaHasResponse<string>;

    if (!responseBodyJson.success) {
      const code = responseBodyJson.code !== undefined ? parseInt(responseBodyJson.code) : undefined;

      // 1004 (signature invalid) means the access token is expired
      // 1010 (expired token) means the refresh token is also expired
      if (code === -9999999 || code === 1004) {
        if (didRefreshToken) {
          this.error('Access token expired, but refresh failed as well', code);
          throw new TuyaOAuth2Error(this.homey.__('error_refreshing_token_access'), response.status, code);
        }

        this.tokenRefreshPromise = (async (): Promise<void> => {
          this.log('Access token expired', code);
          await this.executeTokenRefresh();
          this.log('Token refreshed, retrying request...');
          return this._executeRequest({ method, path, json, query, headers }, true);
        })();
        try {
          await this.tokenRefreshPromise;
        } finally {
          delete this.tokenRefreshPromise;
        }
      } else if (code === 1010) {
        this.log('Refresh token expired', code);
        throw new TuyaOAuth2Error(this.homey.__('error_refreshing_token_refresh'), response.status, code);
      }
      this.error(requestUrl.toString(), ':', responseBodyJson);
      throw new TuyaOAuth2Error(this.homey.__(`tuya_error.${code}`), response.status, code);
    }

    if (responseBodyJson.result === undefined) {
      return undefined as unknown as T;
    }

    const responseBodyDecrypted = TuyaOAuth2Util.aesGcmDecrypt(responseBodyJson.result, secret);
    return JSON.parse(responseBodyDecrypted);
  }

  public async refreshToken(): Promise<void> {
    this.error('The refreshToken method should not be called');
  }

  public async executeTokenRefresh(): Promise<void> {
    this.log('Refreshing token...');
    const token = this.getToken();
    if (!token) {
      // No token? No refresh possible
      return;
    }

    const res = await this._executeRequest<TuyaTokenRefreshResponse>({
      method: 'GET',
      path: `/v1.0/m/token/${token.refresh_token}`,
      isTokenRefresh: true,
    });

    const newToken = new TuyaHaToken({
      ...token.toJSON(),
      uid: res.uid ?? token.uid,
      access_token: res.accessToken,
      refresh_token: res.refreshToken,
      expire_time: res.expireTime ?? token.expire_time,
    });
    this.setToken({ token: newToken });

    this.log('Refreshed token:', JSON.stringify(newToken));

    // Otherwise, the token is not stored in the store!
    this.save();

    // Store last token save and expire time for automated refresh
    this.lastTokenSave = Date.now();
    this.tokenExpireTime = token.expire_time ?? 7200;

    // Wait a little bit to give the refresh token time to propagate
    await new Promise(resolve => this.homey.setTimeout(resolve, 500));
  }

  /*
   * API Methods
   */

  public async getMqttConfig(): Promise<TuyaMqttConfigResponse> {
    const linkId = crypto.randomUUID();
    return this._post('/v1.0/m/life/ha/access/config', {
      linkId: `tuya-device-sharing-sdk-python.${linkId}`,
    });
  }

  public async getHomeDevices({ ownerId }: { ownerId: string }): Promise<TuyaDeviceResponse[]> {
    return this._get(`/v1.0/m/life/ha/home/devices`, { homeId: ownerId });
  }

  public async getHasHomes(): Promise<TuyaHaHome[]> {
    return this._get(`/v1.0/m/life/users/homes`);
  }

  public async getDevices(): Promise<TuyaDeviceResponse[]> {
    const devices: TuyaDeviceResponse[] = [];
    const hasHomes = await this.getHasHomes();
    for (const hasHome of hasHomes) {
      await this.getHomeDevices(hasHome)
        .then(res => devices.push(...res))
        .catch(this.error);
    }
    return devices;
  }

  public async getDevice({ deviceId }: { deviceId: string }): Promise<TuyaDeviceResponse> {
    const devices = await this._get<TuyaDeviceResponse[]>('/v1.0/m/life/ha/devices/detail', { devIds: deviceId });
    return devices[0];
  }

  public async getHasScenes(spaceId: string | number): Promise<TuyaHaScenesResponse> {
    return this._get('/v1.0/m/scene/ha/home/scenes', { homeId: spaceId });
  }

  public async triggerHasScene(ownerId: string, sceneId: string): Promise<boolean> {
    return this._post('/v1.0/m/scene/ha/trigger', { homeId: ownerId, sceneId: sceneId });
  }

  public async getSpecification(deviceId: string): Promise<TuyaDeviceSpecificationResponse> {
    return this._get(`/v1.1/m/life/${deviceId}/specifications`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async queryDataPoints(deviceId: string): Promise<TuyaDeviceDataPointResponse> {
    // NOTE: setting data points is not yet supported, so we don't make them available in flows
    return {
      properties: [],
    };
  }

  public async queryDataPointsSpecification(deviceId: string): Promise<TuyaDeviceDataPointResponse> {
    const response = await this._get<TuyaHaStatusResponse>(`/v1.0/m/life/devices/${deviceId}/status`);
    return {
      properties: response.dpStatusRelationDTOS.map(item => ({
        code: item.dpCode,
        custom_name: '',
        dp_id: item.dpId,
        time: 0,
        type: item.valueType,
        value: item.valueDesc,
      })),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async setDataPoint(deviceId: string, dataPointId: string, value: unknown): Promise<void> {
    // NOTE: setting data points is not yet supported, so we don't make them available in flows
    throw new Error('Setting data points is currently not supported');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getWebRTCConfiguration({ deviceId }: { deviceId: string }): Promise<TuyaWebRTC> {
    throw new Error('Not implemented');
  }

  public async getStreamingLink(
    deviceId: string,
    type: 'RTSP' | 'HLS' | 'FLV' | 'RTMP',
  ): Promise<{
    url: string;
  }> {
    return this._post(`/v1.0/m/ipc/${deviceId}/stream/actions/allocate`, {
      type: type,
    });
  }

  public async getDeviceStatus({ deviceId }: { deviceId: string }): Promise<TuyaStatusResponse> {
    const response = await this.getDevice({ deviceId });
    return response.status;
  }

  public async sendCommands({
    deviceId,
    commands = [],
  }: {
    deviceId: string;
    commands: TuyaCommand[];
  }): Promise<boolean> {
    return this._post(`/v1.1/m/thing/${deviceId}/commands`, {
      commands: commands,
    });
  }

  private async _get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const requestId = nanoid();
    this.log('GET', requestId, path);
    return await this.get<T>({ path, query }).then(result => {
      this.log('GET Response', requestId, JSON.stringify(result));
      return result;
    });
  }

  private async _post<T>(path: string, payload?: unknown): Promise<T> {
    const requestId = nanoid();
    this.log('POST', requestId, path, JSON.stringify(payload));
    return await this.post<T>({ path, json: payload }).then(result => {
      this.log('POST Response', requestId, JSON.stringify(result));

      return result;
    });
  }

  /*
   * Infrared
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async getRemotes(infraredControllerId: string): Promise<TuyaIrRemoteResponse[]> {
    return [];
    // return this._get(`/v2.0/infrareds/${infraredControllerId}/remotes`);
  }

  public async getRemoteKeys(
    infraredControllerId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    infraredRemoteId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<TuyaIrRemoteKeysResponse> {
    throw new Error('Not implemented');
    // return this._get(`/v2.0/infrareds/${infraredControllerId}/remotes/${infraredRemoteId}/keys`);
  }

  public async sendKeyCommand(
    infraredControllerId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    infraredRemoteId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    categoryId: number, // eslint-disable-line @typescript-eslint/no-unused-vars
    keyId?: number, // eslint-disable-line @typescript-eslint/no-unused-vars
    keyString?: string, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<boolean> {
    throw new Error('Not implemented');
    // return this._post(`/v2.0/infrareds/${infraredControllerId}/remotes/${infraredRemoteId}/raw/command`, {
    //   category_id: categoryId,
    //   key_id: keyId,
    //   key: keyString,
    // });
  }

  public async sendAircoCommand(
    infraredControllerId: string,
    infraredRemoteId: string,
    code: string,
    value: number,
  ): Promise<boolean> {
    return this._post(`/v2.0/infrareds/${infraredControllerId}/air-conditioners/${infraredRemoteId}/command`, {
      code: code,
      value: value,
    });
  }

  /*
   * MQTT
   */
  private registeredDevices = new Map<string, DeviceRegistration>();
  // Devices that are added as 'other' may be duplicates
  private registeredOtherDevices = new Map<string, DeviceRegistration>();

  public registerDevice(
    {
      productId,
      deviceId,
      onStatus = async (): Promise<void> => {
        /* empty */
      },
    }: DeviceRegistration,
    other = false,
  ): void {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    register.set(deviceId, {
      productId,
      deviceId,
      onStatus,
    });
    // Only subscribe once for each device, so check if device is already in the other register
    if (!this.isRegistered(productId, deviceId, !other)) {
      this.subscribeToMqtt(deviceId).catch(this.error);
    }
  }

  public unregisterDevice({ productId, deviceId }: { productId: string; deviceId: string }, other = false): void {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    register.delete(deviceId);
    // Only unsubscribe if there are no registrations for the device left, so check if device is still in the other register
    if (!this.isRegistered(productId, deviceId, !other)) {
      this.unsubscribeFromMqtt(deviceId).catch(this.error);
    }
  }

  public isRegistered(productId: string, deviceId: string, other = false): boolean {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    return register.has(deviceId);
  }

  public save(): void {
    // Reset MQTT to force reconnect
    this.resetMqtt();

    // Clear devices, due to the save action they will be registered again
    this.registeredDevices.clear();
    this.registeredOtherDevices.clear();

    // Execute original save, which will store the token in the app store
    super.save();
  }

  public resetMqtt(): void {
    if (this.requestingMqttConfig) {
      // Do not reset MQTT while requesting config
      return;
    }

    this.log('Resetting MQTT');
    this.mqttClient?.end(true);
    this.mqttClient = undefined;
    this.mqttPromise = undefined;
  }

  public async connectToMqtt(): Promise<void> {
    if (this.mqttPromise !== undefined) {
      return this.mqttPromise;
    }

    let resolveMqttPromise: () => void = noop;
    try {
      this.mqttPromise = new Promise<void>(resolve => {
        resolveMqttPromise = resolve;
      });
      this.log('Connecting to MQTT');

      let mqttConfig: TuyaMqttConfigResponse;
      try {
        this.requestingMqttConfig = true;
        mqttConfig = await this.getMqttConfig();
      } finally {
        this.requestingMqttConfig = false;
      }

      this.log('MQTT config:', JSON.stringify(mqttConfig));
      this.mqttConfig = mqttConfig;
      this.mqttClient = await mqtt.connectAsync(mqttConfig.url, {
        clientId: mqttConfig.clientId,
        username: mqttConfig.username,
        password: mqttConfig.password,
      });
      this.mqttClient.on('message', async (topic, message) => {
        const json = JSON.parse(message.toString()) as TuyaMqttMessage;

        this.log('Incoming MQTT:', JSON.stringify(json.data));

        const deviceId = json.data.devId ?? json.data.bizData.devId;
        const dataPoints = json.data.status ?? [];

        const status: { [key: string]: unknown } = {};
        const changedStatusCodes: string[] = [];

        for (const dataPoint of dataPoints) {
          const unknownDatapoint = dataPoint as Record<`${number}`, unknown>;
          if (
            typeof unknownDatapoint === 'object' &&
            Object.keys(unknownDatapoint).length === 1 &&
            Number.isInteger(Object.keys(unknownDatapoint)[0])
          ) {
            // When in form of `{"4":"low"}`, skip.
            continue;
          }

          if (dataPoint.code === undefined) {
            this.error('Malformed datapoint:', JSON.stringify(dataPoint));
            continue;
          }
          status[dataPoint.code] = dataPoint.value;
          changedStatusCodes.push(dataPoint.code);
        }

        if (['online', 'offline'].includes(json.data.bizCode)) {
          status['online'] = json.data.bizCode === 'online';
          changedStatusCodes.push('online');
        }

        const registeredDevice = this.registeredDevices.get(deviceId);
        const registeredOtherDevice = this.registeredOtherDevices.get(deviceId);
        if (registeredDevice === undefined && registeredOtherDevice === undefined) {
          this.log('No matching devices found for MQTT data');
          return;
        }

        if (registeredDevice !== undefined) {
          await registeredDevice.onStatus('status', status, changedStatusCodes).catch(this.error);
        }
        if (registeredOtherDevice !== undefined) {
          await registeredOtherDevice.onStatus('status', status, changedStatusCodes).catch(this.error);
        }
      });
    } finally {
      resolveMqttPromise();
    }
  }

  public async subscribeToMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      await this.connectToMqtt();
    }

    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);

    await this.mqttClient!.subscribeAsync(topic);
    this.log('Subscribed to MQTT channel for device:', deviceId);
  }

  public async unsubscribeFromMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      return;
    }

    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);
    await this.mqttClient.unsubscribeAsync(topic);
    this.log('Unsubscribed from MQTT channel for device:', deviceId);
  }

  private refreshApiToken(): void {
    if (Date.now() - this.lastTokenSave < (this.tokenExpireTime - 600) * 1000) {
      // No need to refresh
      return;
    }

    if (!this.getToken()) {
      // No token? No automatic refresh!
      return;
    }

    if (this.tokenRefreshPromise) {
      // Refresh already in progress
      return;
    }

    this.log('Automatic token refresh');
    this.tokenRefreshPromise = this.executeTokenRefresh()
      .then(() => this.setTokenError(false))
      .catch(e => this.setTokenError(true, e))
      .finally(() => {
        this.debug('Cleared token refresh promise (automated refresh)');
        delete this.tokenRefreshPromise;
      });
  }

  private setTokenError(value: boolean, warning?: unknown): void {
    this.log('Token error state updated', value, warning);
    this.emit('token_error', value);
  }

  private debug(...args: unknown[]): void {
    if (Homey.env.DEBUG !== '1') {
      return;
    }

    super.log('[dbg]', ...args);
  }
}

TuyaHaClient.setMaxListeners(Infinity);
