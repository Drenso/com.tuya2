import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';
import { constIncludes } from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';
import {
  GARAGE_DOOR_CAPABILITIES,
  GRAGE_DOOR_CAPABILITIES_MAPPING,
  type HomeyGarageDoorSettings,
} from './TuyaGarageDoorConstants.js';

export default class TuyaOAuth2DeviceGarageDoor extends TuyaOAuth2Device {
  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    if (this.hasCapability('garagedoor_closed')) {
      this.registerCapabilityListener('garagedoor_closed', value =>
        this.sendCommand({
          code: 'switch_1',
          value: !value,
        }),
      );
    }
  }

  async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];

      if (tuyaCapability === 'switch_1') {
        const homeyCapability = GRAGE_DOOR_CAPABILITIES_MAPPING[tuyaCapability];
        await this.safeSetCapabilityValue(homeyCapability, !value);
      }

      if (tuyaCapability === 'doorcontact_state') {
        const homeyCapability = GRAGE_DOOR_CAPABILITIES_MAPPING[tuyaCapability];
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(GARAGE_DOOR_CAPABILITIES.setting, tuyaCapability)) {
        await this.safeSetSettingValue(tuyaCapability, value);
      }
    }
  }

  onSettings(event: SettingsEvent<HomeyGarageDoorSettings>): Promise<string | void> {
    return TuyaOAuth2Util.onSettings(this, event, this.SETTING_LABELS);
  }
};
