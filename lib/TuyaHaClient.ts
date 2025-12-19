import { fetch, OAuth2Client } from 'homey-oauth2app';
import { nanoid } from 'nanoid';

import { URL } from 'url';
import {
  TuyaCommand,
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
  TuyaStatusResponse,
  TuyaWebRTC,
} from '../types/TuyaApiTypes';
import { getTuyaClientId } from './TuyaHaClientId';
import * as TuyaOAuth2Util from './TuyaOAuth2Util';
import TuyaHaToken from './TuyaHaToken';
import {
  TuyaHaHome,
  TuyaHasResponse,
  TuyaHaScenesResponse,
  TuyaHaStatusResponse,
  TuyaMqttConfigResponse,
  TuyaMqttMessage,
  TuyaTokenRefreshResponse,
} from '../types/TuyaHaApiTypes';
import crypto from 'crypto';
import TuyaOAuth2Error from './TuyaOAuth2Error';
import { DeviceRegistration } from '../types/TuyaTypes';
import mqtt from 'mqtt';

type OAuth2SessionInformation = { id: string; title: string };

export default class TuyaHaClient extends OAuth2Client<TuyaHaToken> {
  static TOKEN = TuyaHaToken;
  static API_URL = '<dummy>';
  static TOKEN_URL = '<dummy>';
  static AUTHORIZATION_URL = 'https://openapi.tuyaus.com/login';
  static REDIRECT_URL = 'https://tuya.athom.com/callback';

  mqttPromise?: Promise<void>;
  mqttConfig?: TuyaMqttConfigResponse;
  mqttClient?: mqtt.MqttClient;

  resolveReadyPromise!: () => void;
  readyPromise = new Promise<void>(resolve => {
    this.resolveReadyPromise = resolve;
  });

  private tokenRefresher?: NodeJS.Timeout;
  private lastTokenSave = 0; // This default will ensure an automated refresh 30 seconds after app start
  private tokenExpireTime = 7200; // 2 hours in seconds

  // We save this information to eventually enable OAUTH2_MULTI_SESSION.
  // We can then list all authenticated users by name, e-mail and country flag.
  // This is useful for multiple account across Tuya brands & regions.
  async onGetOAuth2SessionInformation(): Promise<OAuth2SessionInformation> {
    const token = this.getToken();
    return {
      id: token.uid,
      title: token.username,
    };
  }

  async onInit(): Promise<void> {
    this.error = this.error.bind(this);
    this.resolveReadyPromise();

    // Automatic token refresher as this app relies on MQTT data, which doesn't refresh the token automatically
    this.tokenRefresher = this.homey.setInterval(() => this.refreshApiToken(), 30 * 1000);
  }

  async onUninit(): Promise<void> {
    if (this.tokenRefresher) {
      this.homey.clearInterval(this.tokenRefresher);
    }
  }

  // Sign the request
  async _executeRequest<T>(
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
    if (!isTokenRefresh) {
      await this._refreshingToken;
    }

    const token = this.getToken();

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
      // "sign invalid" means our tokens are expired
      // code 1010 means the refresh token is also expired?
      if (responseBodyJson.code === '-9999999') {
        if (didRefreshToken) {
          throw new TuyaOAuth2Error(this.homey.__('error_refreshing_token'));
        }

        await this.refreshToken();
        return this._executeRequest({ method, path, json, query, headers }, true);
      } else if (responseBodyJson.code === '1010') {
        throw new TuyaOAuth2Error(this.homey.__('error_refreshing_token'));
      }
      throw new Error(`[${responseBodyJson.code}] ${responseBodyJson.msg}`);
    }

    if (responseBodyJson.result === undefined) {
      return undefined as unknown as T;
    }

    const responseBodyDecrypted = TuyaOAuth2Util.aesGcmDecrypt(responseBodyJson.result, secret);
    return JSON.parse(responseBodyDecrypted);
  }

  async refreshToken(): Promise<void> {
    if (this._refreshingToken) {
      return await this._refreshingToken;
    }
    this.log('Refreshing token...');
    const token = this.getToken();
    this._refreshingToken = this._executeRequest<TuyaTokenRefreshResponse>({
      method: 'GET',
      path: `/v1.0/m/token/${token.refresh_token}`,
      isTokenRefresh: true,
    })
      .then(res => {
        const newToken = new TuyaHaToken({
          ...token.toJSON(),
          access_token: res.accessToken,
          refresh_token: res.refreshToken,
        });
        this.setToken({ token: newToken });
        // Otherwise, the token is not stored in the store!
        this.save();

        // Store last token save and expire time for automated refresh
        this.lastTokenSave = Date.now();
        this.tokenExpireTime = token.expire_time ?? 7200;

        this.log('Refreshed token:', newToken);
      })
      .finally(() => {
        this._refreshingToken = null;
      });
    return this._refreshingToken;
  }

  /*
   * API Methods
   */

  async getMqttConfig(): Promise<TuyaMqttConfigResponse> {
    const linkId = crypto.randomUUID();
    return this._post('/v1.0/m/life/ha/access/config', {
      linkId: `tuya-device-sharing-sdk-python.${linkId}`,
    });
  }

  async getHomeDevices({ ownerId }: { ownerId: string }): Promise<TuyaDeviceResponse[]> {
    return this.get({
      path: `/v1.0/m/life/ha/home/devices`,
      query: { homeId: ownerId },
    });
  }

  async getHasHomes(): Promise<TuyaHaHome[]> {
    return this._get(`/v1.0/m/life/users/homes`);
  }

  async getDevices(): Promise<TuyaDeviceResponse[]> {
    const devices: TuyaDeviceResponse[] = [];
    const hasHomes = await this.getHasHomes();
    for (const hasHome of hasHomes) {
      await this.getHomeDevices(hasHome)
        .then(res => devices.push(...res))
        .catch(this.error);
    }
    return devices;
  }

  async getDevice({ deviceId }: { deviceId: string }): Promise<TuyaDeviceResponse> {
    const devices = await this.get<TuyaDeviceResponse[]>({
      path: '/v1.0/m/life/ha/devices/detail',
      query: {
        devIds: deviceId,
      },
    });
    return devices[0];
  }

  async getHasScenes(spaceId: string | number): Promise<TuyaHaScenesResponse> {
    return this.get({
      path: '/v1.0/m/scene/ha/home/scenes',
      query: { homeId: spaceId },
    });
  }

  async triggerHasScene(ownerId: string, sceneId: string): Promise<boolean> {
    return this._post('/v1.0/m/scene/ha/trigger', { homeId: ownerId, sceneId: sceneId });
  }

  async getSpecification(deviceId: string): Promise<TuyaDeviceSpecificationResponse> {
    return this.get({
      path: `/v1.1/m/life/${deviceId}/specifications`,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async queryDataPoints(deviceId: string): Promise<TuyaDeviceDataPointResponse> {
    // NOTE: setting data points is not yet supported, so we don't make them available in flows
    return {
      properties: [],
    };
  }

  async queryDataPointsSpecification(deviceId: string): Promise<TuyaDeviceDataPointResponse> {
    const response = await this.get<TuyaHaStatusResponse>({
      path: `/v1.0/m/life/devices/${deviceId}/status`,
    });
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
  async setDataPoint(deviceId: string, dataPointId: string, value: unknown): Promise<void> {
    // NOTE: setting data points is not yet supported, so we don't make them available in flows
    throw new Error('Setting data points is currently not supported');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getWebRTCConfiguration({ deviceId }: { deviceId: string }): Promise<TuyaWebRTC> {
    throw new Error('Not implemented');
  }

  async getStreamingLink(
    deviceId: string, // eslint-disable-line @typescript-eslint/no-unused-vars
    type: 'RTSP' | 'HLS', // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<{
    url: string;
  }> {
    throw new Error('Not implemented');
  }

  async getDeviceStatus({ deviceId }: { deviceId: string }): Promise<TuyaStatusResponse> {
    const response = await this.getDevice({ deviceId });
    return response.status;
  }

  async sendCommands({ deviceId, commands = [] }: { deviceId: string; commands: TuyaCommand[] }): Promise<boolean> {
    return this._post(`/v1.1/m/thing/${deviceId}/commands`, {
      commands: commands,
    });
  }

  private async _get<T>(path: string): Promise<T> {
    const requestId = nanoid();
    this.log('GET', requestId, path);
    return await this.get<T>({ path }).then(result => {
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
   * MQTT
   */
  private registeredDevices = new Map<string, DeviceRegistration>();
  // Devices that are added as 'other' may be duplicates
  private registeredOtherDevices = new Map<string, DeviceRegistration>();

  registerDevice(
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

  unregisterDevice({ productId, deviceId }: { productId: string; deviceId: string }, other = false): void {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    register.delete(deviceId);
    // Only unsubscribe if there are no registrations for the device left, so check if device is still in the other register
    if (!this.isRegistered(productId, deviceId, !other)) {
      this.unsubscribeFromMqtt(deviceId).catch(this.error);
    }
  }

  isRegistered(productId: string, deviceId: string, other = false): boolean {
    const register = other ? this.registeredOtherDevices : this.registeredDevices;
    return register.has(deviceId);
  }

  save(): void {
    // Reset MQTT to force reconnect
    this.resetMqtt();

    // Clear devices, due to the save action they will be registered again
    this.registeredDevices.clear();
    this.registeredOtherDevices.clear();

    // Execute original save, which will store the token in the app store
    super.save();
  }

  resetMqtt(): void {
    this.mqttClient?.end(true);
    this.mqttClient = undefined;
    this.mqttPromise = undefined;
  }

  async connectToMqtt(): Promise<void> {
    if (this.mqttPromise !== undefined) {
      return this.mqttPromise;
    }
    let resolveMqttPromise: () => void = () => {
      return;
    };
    this.mqttPromise = new Promise<void>(resolve => {
      resolveMqttPromise = resolve;
    });
    this.log('Connecting to MQTT');
    const mqttConfig = await this.getMqttConfig();
    this.mqttConfig = mqttConfig;
    this.mqttClient = await mqtt.connectAsync(mqttConfig.url, {
      clientId: mqttConfig.clientId,
      username: mqttConfig.username,
      password: mqttConfig.password,
    });
    this.mqttClient.on('message', async (topic, message) => {
      const json = JSON.parse(message.toString()) as TuyaMqttMessage;

      this.log('Incoming MQTT:', json.data);

      const deviceId = json.data.devId;
      const dataPoints = json.data.status ?? [];

      const status: { [key: string]: unknown } = {};
      const changedStatusCodes: string[] = [];

      for (const dataPoint of dataPoints) {
        if (dataPoint.code === undefined) {
          this.error('Malformed datapoint:', JSON.stringify(dataPoint));
          continue;
        }
        status[dataPoint.code] = dataPoint.value;
        changedStatusCodes.push(dataPoint.code);
      }

      const registeredDevice = this.registeredDevices.get(deviceId);
      const registeredOtherDevice = this.registeredOtherDevices.get(deviceId);
      if (registeredDevice === undefined && registeredOtherDevice === undefined) {
        this.log('No matching devices found for webhook data');
        return;
      }

      if (registeredDevice !== undefined) {
        await registeredDevice.onStatus('status', status, changedStatusCodes).catch(this.error);
      }
      if (registeredOtherDevice !== undefined) {
        await registeredOtherDevice.onStatus('status', status, changedStatusCodes).catch(this.error);
      }
    });
    resolveMqttPromise();
  }

  async subscribeToMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      await this.connectToMqtt();
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    await this.mqttClient!.subscribeAsync(topic);
    this.log('Subscribed to MQTT channel for device:', deviceId);
  }

  async unsubscribeFromMqtt(deviceId: string): Promise<void> {
    if (!this.mqttClient) {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const topicTemplate = this.mqttConfig!.topic.devId.sub;
    const topic = topicTemplate.replace('{devId}', deviceId);
    await this.mqttClient.unsubscribeAsync(topic);
    this.log('Unsubscribed from MQTT channel for device:', deviceId);
  }

  private refreshApiToken(): void {
    const token = this.getToken();
    if (token && Date.now() - this.lastTokenSave < (this.tokenExpireTime - 100) * 1000) {
      // No need to refresh
      return;
    }

    this.log('Automatic token refresh');
    this.refreshToken()
      .then(() => this.setTokenError(false))
      .catch(e => this.setTokenError(true, e))
      .catch(e => this.setTokenError(false, e));
  }

  private setTokenError(value: boolean, warning?: unknown): void {
    this.log('Token error state updated', value, warning);
    this.emit('token_error', value);
  }
}

TuyaHaClient.setMaxListeners(Infinity);
module.exports = TuyaHaClient;
