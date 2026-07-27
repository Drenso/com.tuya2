import TuyaOAuth2DeviceSensor from '../../lib/sensor/TuyaOAuth2DeviceSensor.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';
import { computeScaleFactor, constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';
import {
  CLIMATE_CAPABILITY_MAPPING,
  CLIMATE_SENSOR_CAPABILITIES,
  type HomeyClimateSensorSettings,
} from './TuyaClimateSensorConstants.js';

export default class TuyaOAuth2DeviceSensorClimate extends TuyaOAuth2DeviceSensor {
  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', value => this.sendCommand({ code: 'switch', value }));
    }
  }

  public async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    // battery_state, battery_percentage and temper_alarm are handled by the superclass
    await super.onTuyaStatus(status, changedStatusCodes);

    for (const tuyaCapability in status) {
      const homeyCapability = getFromMap(CLIMATE_CAPABILITY_MAPPING, tuyaCapability);
      const value = status[tuyaCapability];

      if (
        (constIncludes(CLIMATE_SENSOR_CAPABILITIES.read_only, tuyaCapability) ||
          constIncludes(CLIMATE_SENSOR_CAPABILITIES.read_write, tuyaCapability)) &&
        homeyCapability
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(CLIMATE_SENSOR_CAPABILITIES.read_only_scaled, tuyaCapability) && homeyCapability) {
        const scaling = computeScaleFactor(this.getSetting(`${tuyaCapability}_scaling`));
        await this.safeSetCapabilityValue(homeyCapability, (status[tuyaCapability] as number) / scaling);
      }

      // Battery
      if (tuyaCapability === 'battery_value' && homeyCapability) {
        const scaledValue = (value as number) / 300;
        await this.safeSetCapabilityValue(homeyCapability, scaledValue);
      }

      if (tuyaCapability === 'va_battery' && homeyCapability) {
        const scaledValue = (value as number) / 100;
        await this.safeSetCapabilityValue(homeyCapability, scaledValue);
      }
    }
  }

  public async onSettings(event: SettingsEvent<HomeyClimateSensorSettings>): Promise<string | void> {
    for (const tuyaCapability of ['va_temperature', 'va_humidity', 'bright_value'] as const) {
      const homeyCapability = CLIMATE_CAPABILITY_MAPPING[tuyaCapability];
      await TuyaOAuth2Util.handleScaleSetting(this, event, `${tuyaCapability}_scaling`, homeyCapability).catch(
        this.error,
      );
    }
  }
}
