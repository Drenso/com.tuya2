import { fetch, OAuth2DeviceResult, OAuth2Driver, OAuth2Util } from 'homey-oauth2app';
import {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../types/TuyaApiTypes';
import type { StandardFlowArgs, Translation } from '../types/TuyaTypes';
import { getTuyaClientId } from './TuyaHaClientId';
import * as TuyaOAuth2Util from './TuyaOAuth2Util';
import { sendSetting } from './TuyaOAuth2Util';
import PairSession from 'homey/lib/PairSession';
import { URL } from 'url';
import { Response } from 'node-fetch';
import { type TuyaQrCodeResponse } from '../types/TuyaHaApiTypes';
import TuyaHaToken from './TuyaHaToken';
import TuyaHaClient from './TuyaHaClient';
import QRCode from 'qrcode';
import type TuyaOAuth2Device from './TuyaOAuth2Device';

export type ListDeviceProperties = {
  store: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  settings: {
    [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  capabilities: string[];
  capabilitiesOptions: {
    [key: string]: {
      [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
  };
};

const USER_CODE_KEY = 'TUYA_USER_CODE';

export default class TuyaOAuth2Driver extends OAuth2Driver<TuyaHaClient> {
  TUYA_DEVICE_CATEGORIES: ReadonlyArray<string> = [];

  async onRepair(session: PairSession, device?: TuyaOAuth2Device): Promise<void> {
    return this.onPair(session, device);
  }

  async onPair(session: PairSession, device?: TuyaOAuth2Device): Promise<void> {
    const OAuth2ConfigId = this.getOAuth2ConfigId();
    let OAuth2SessionId = '$new';
    let client: TuyaHaClient = this.homey.app.createOAuth2Client({
      sessionId: OAuth2Util.getRandomId(),
      configId: OAuth2ConfigId,
    });

    const OAuth2Config = this.homey.app.getConfig({
      configId: OAuth2ConfigId,
    });
    const { allowMultiSession } = OAuth2Config;
    if (!allowMultiSession) {
      const savedSessions = this.homey.app.getSavedOAuth2Sessions();
      if (Object.keys(savedSessions).length) {
        OAuth2SessionId = Object.keys(savedSessions)[0];
        try {
          client = this.homey.app.getOAuth2Client({
            configId: OAuth2ConfigId,
            sessionId: OAuth2SessionId,
          });
          this.log(`Multi-Session disabled. Selected ${OAuth2SessionId} as active session.`);
        } catch (err) {
          this.error(err);
        }
      }
    }

    let waitingForQrScan = true;
    const schema = 'haauthorize';

    session.setHandler('showView', async view => {
      // Skip authentication if we already have a session
      if (view === 'usercode' && OAuth2SessionId !== '$new' && client.getToken() !== null) {
        session.showView('list_devices').catch(this.error);
        return;
      }
    });

    const waitForQrCodeScan = async (qrcode: string, userCode: string): Promise<TuyaHaClient | undefined> => {
      const url = new URL(`https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens/${qrcode}`);
      url.searchParams.append('clientid', getTuyaClientId());
      url.searchParams.append('usercode', userCode);

      const wait = async (ms: number): Promise<void> => {
        return new Promise(resolve => setTimeout(resolve, ms));
      };

      while (waitingForQrScan) {
        try {
          const tokenResponse = await fetch(url);

          if (!tokenResponse.ok) {
            throw new Error(tokenResponse.statusText);
          }

          const tokenJson = await tokenResponse.json();

          if (!tokenJson.success && tokenJson.code === 'E0020003') {
            // QR code was not scanned yet
            await wait(500);
            continue;
          }

          if (!tokenJson.success || !tokenJson.result) {
            throw new Error(tokenJson.msg ?? tokenJson.code);
          }

          const tokenResult = tokenJson.result;
          const token = new TuyaHaToken(tokenResult);
          client.setToken({
            token: token,
          });

          const session = await client.onGetOAuth2SessionInformation();
          const sessionWasNew = OAuth2SessionId === '$new';
          OAuth2SessionId = session.id;
          const { title } = session;

          if (sessionWasNew) {
            // Destroy the temporary client
            client.destroy();

            // Replace the temporary client by the final one
            client = this.homey.app.createOAuth2Client({
              sessionId: session.id,
              configId: OAuth2ConfigId,
            });
          }

          client.setTitle({ title });
          client.setToken({ token });

          // NOTE: Save the client even if no device is added
          client.save();

          return client;
        } catch (error) {
          this.error('Error while fetching QR scan result:', error);
        }
        await wait(500);
      }

      return undefined;
    };

    session.setHandler('load_usercode', async () => {
      const loadedCode = this.homey.settings.get(USER_CODE_KEY);
      if (!loadedCode) {
        return null;
      }

      return loadedCode;
    });

    session.setHandler('usercode', async userCode => {
      const url = new URL('https://apigw.iotbing.com/v1.0/m/life/home-assistant/qrcode/tokens');
      url.searchParams.append('clientid', getTuyaClientId());
      url.searchParams.append('schema', schema);
      url.searchParams.append('usercode', userCode);

      const qrcodeResponse: Response = await fetch(url, {
        method: 'POST',
      });

      if (!qrcodeResponse.ok) {
        throw new Error(qrcodeResponse.statusText);
      }

      const qrcodeJson = (await qrcodeResponse.json()) as TuyaQrCodeResponse;

      if (!qrcodeJson.success || !qrcodeJson.result) {
        throw new Error(qrcodeJson.msg ?? qrcodeJson.code);
      }

      this.homey.settings.set(USER_CODE_KEY, userCode);

      const qrcode = qrcodeJson.result.qrcode;
      waitForQrCodeScan(qrcode, userCode)
        .then(res => {
          if (res !== undefined) {
            if (device !== undefined) {
              device.setAvailable();
            }
            return session.nextView();
          }
        })
        .finally(() => {
          waitingForQrScan = false;
        });
      return await QRCode.toDataURL(`tuyaSmart--qrLogin?token=${qrcode}`, {
        errorCorrectionLevel: 'H',
        type: 'image/webp',
        width: 1024,
      });
    });

    session.setHandler('list_devices', async () => {
      const devices = await this.onPairListDevices({
        oAuth2Client: client,
      });

      return devices.map(device => {
        return {
          ...device,
          store: {
            ...device.store,
            OAuth2SessionId,
            OAuth2ConfigId,
          },
        };
      });
    });

    session.setHandler('disconnect', async () => {
      this.log('Disconnected');
      waitingForQrScan = false;
    });
  }

  async onPairListDevices({ oAuth2Client }: { oAuth2Client: TuyaHaClient }): Promise<OAuth2DeviceResult[]> {
    let devices: TuyaDeviceResponse[] = [];
    try {
      devices = await oAuth2Client.getDevices();
    } catch (err) {
      this.log('Failed to get devices from cloud, proceeding with manual only:', err);
    }

    const filteredDevices = devices.filter(device => {
      return !oAuth2Client.isRegistered(device.product_id, device.id) && this.onTuyaPairListDeviceFilter(device);
    });

    // Manual injection removed

    const listDevices: OAuth2DeviceResult[] = [];

    this.log('Listing devices to pair:');

    const devicePromises = filteredDevices.map(async device => {
      this.log('Device:', JSON.stringify(TuyaOAuth2Util.redactFields(device)));
      const deviceSpecs =
        (await oAuth2Client
          .getSpecification(device.id)
          .catch(e => this.log('Device specification retrieval failed', e))) ?? undefined;
      const dataPoints =
        (await oAuth2Client
          .queryDataPointsSpecification(device.id)
          .catch(e => this.log('Device properties retrieval failed', e))) ?? undefined;

      // GitHub #178: Some device do not have the status property at all.
      // Make sure to populate it with an empty array instead.
      if (!Array.isArray(device.status)) {
        device.status = [];
      }

      const deviceProperties = this.onTuyaPairListDeviceProperties({ ...device }, deviceSpecs, dataPoints);

      return {
        ...deviceProperties,
        name: device.name,
        data: {
          deviceId: device.id,
          productId: device.product_id,
        },
      };
    });

    listDevices.push(...await Promise.all(devicePromises));
    return listDevices;
  }

  onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
    return this.TUYA_DEVICE_CATEGORIES.includes(device.category);
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse, // eslint-disable-line @typescript-eslint/no-unused-vars
    specifications?: TuyaDeviceSpecificationResponse, // eslint-disable-line @typescript-eslint/no-unused-vars
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const combinedSpecification = {
      device: TuyaOAuth2Util.redactFields(device),
      specifications: specifications ?? '<not available>',
      data_points: dataPoints?.properties ?? '<not available>',
    };

    return {
      capabilities: [],
      store: {
        tuya_capabilities: [],
        tuya_category: device.category,
      },
      capabilitiesOptions: {},
      settings: {
        deviceSpecification: JSON.stringify(combinedSpecification, undefined, 2),
      },
    };
  }

  protected addSettingFlowHandler<K extends string, L extends Record<K, Translation>>(setting: K, labels: L): void {
    this.homey.flow
      .getActionCard(`${this.id}_${setting}`)
      .registerRunListener(
        async (args: StandardFlowArgs) => await sendSetting(args.device, setting, args.value, labels),
      );
  }
}

module.exports = TuyaOAuth2Driver;
