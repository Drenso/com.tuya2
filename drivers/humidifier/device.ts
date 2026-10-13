import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import { computeScaleFactor, constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';
import {
  type HomeyHumidifierSettings,
  HUMIDIFIER_CAPABILITIES,
  HUMIDIFIER_CAPABILITY_MAPPING,
} from './TuyaHumidifierConstants.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';
import * as HumidifierMigrations from '../../lib/migrations/HumidifierMigrations.js';

export default class TuyaOAuth2DeviceHumidifier extends TuyaOAuth2Device {
  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    for (const tuyaCapability of HUMIDIFIER_CAPABILITIES.read_write) {
      const homeyCapability = getFromMap(HUMIDIFIER_CAPABILITY_MAPPING, tuyaCapability);
      if (homeyCapability && this.hasCapability(homeyCapability)) {
        this.registerCapabilityListener(homeyCapability, value =>
          this.sendCommand({
            code: tuyaCapability,
            value: value,
          }),
        );
      }
    }

    for (const tuyaCapability of HUMIDIFIER_CAPABILITIES.read_write_scaled) {
      const homeyCapability = HUMIDIFIER_CAPABILITY_MAPPING[tuyaCapability];
      if (homeyCapability && this.hasCapability(homeyCapability)) {
        this.registerCapabilityListener(homeyCapability, value => {
          const scaling = computeScaleFactor(this.getSetting(`${homeyCapability}_scaling`));
          return this.sendCommand({
            code: tuyaCapability,
            value: value * scaling,
          });
        });
      }
    }
  }

  protected async performMigrations(): Promise<void> {
    await super.performMigrations();
    await HumidifierMigrations.performMigrations(this);
  }

  public async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];
      const homeyCapability = getFromMap(HUMIDIFIER_CAPABILITY_MAPPING, tuyaCapability);

      if (
        constIncludes(HUMIDIFIER_CAPABILITIES.read_write, tuyaCapability) ||
        constIncludes(HUMIDIFIER_CAPABILITIES.read_only, tuyaCapability)
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(HUMIDIFIER_CAPABILITIES.read_write_scaled, tuyaCapability)) {
        const scaling = computeScaleFactor(this.getSetting(`${homeyCapability}_scaling`));
        await this.safeSetCapabilityValue(homeyCapability, (value as number) / scaling);
      }
    }
  }

  public async onSettings(event: SettingsEvent<HomeyHumidifierSettings>): Promise<string | void> {
    for (const tuyaCapability of HUMIDIFIER_CAPABILITIES.read_write_scaled) {
      const homeyCapability = HUMIDIFIER_CAPABILITY_MAPPING[tuyaCapability];
      await TuyaOAuth2Util.handleScaleSetting(this, event, `${homeyCapability}_scaling`, homeyCapability).catch(
        this.error,
      );
    }
  }
}
