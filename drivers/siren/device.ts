import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';
import {
  type HomeSirenSettings,
  SIREN_CAPABILITIES,
  SIREN_CAPABILITIES_MAPPING,
  type TuyaSirenSettings,
} from './TuyaSirenConstants.js';

export default class TuyaOAuth2DeviceSiren extends TuyaOAuth2Device {
  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    for (const [tuyaCapability, capability] of Object.entries(SIREN_CAPABILITIES_MAPPING)) {
      if (this.hasCapability(capability)) {
        this.registerCapabilityListener(capability, value => this.sendCommand({ code: tuyaCapability, value }));
      }
    }
  }

  public async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const statusKey in status) {
      const value = status[statusKey];

      const capability = getFromMap(SIREN_CAPABILITIES_MAPPING, statusKey);
      if (capability) {
        await this.setCapabilityValue(capability, value).catch(this.error);
      }

      if (statusKey === 'battery_state') {
        await this.setCapabilityValue('alarm_battery', status['battery_state'] === 'low').catch(this.error);
      }

      if (constIncludes(SIREN_CAPABILITIES.setting, statusKey)) {
        await this.safeSetSettingValue(statusKey, value);
      }
    }
  }

  public async onSettings(event: SettingsEvent<HomeSirenSettings>): Promise<string | void> {
    return await TuyaOAuth2Util.onSettings<TuyaSirenSettings>(this, event, this.SETTING_LABELS);
  }
}
