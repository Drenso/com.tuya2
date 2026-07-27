import type { OAuth2DeviceResult } from 'homey-oauth2app';
import TuyaHaClient from '../../lib/TuyaHaClient.js';
import TuyaOAuth2Driver from '../../lib/TuyaOAuth2Driver.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';

export default class TuyaOAuth2DriverOther extends TuyaOAuth2Driver {
  async onPairListDevices({ oAuth2Client }: { oAuth2Client: TuyaHaClient }): Promise<OAuth2DeviceResult[]> {
    const devices = await oAuth2Client.getDevices();
    const listDevices: OAuth2DeviceResult[] = [];

    this.log('Listing devices to pair:');

    for (const device of devices) {
      this.log('Device:', JSON.stringify(TuyaOAuth2Util.redactFields(device)));

      // GitHub #178: Some device do not have the status property at all.
      // Make sure to populate it with an empty array instead.
      if (!Array.isArray(device.status)) {
        device.status = [];
      }

      const deviceProperties = super.onTuyaPairListDeviceProperties({ ...device }, undefined, undefined);

      listDevices.push({
        ...deviceProperties,
        name: device.name,
        data: {
          deviceId: device.id,
          productId: device.product_id,
        },
      });
    }

    return listDevices;
  }
};
