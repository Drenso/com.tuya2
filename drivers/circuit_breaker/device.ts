import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes';
import { constIncludes, filterTuyaSettings, getFromMap } from '../../lib/TuyaOAuth2Util';
import * as Util from '../../lib/TuyaOAuth2Util';
import {
  CIRCUIT_BREAKER_CAPABILITIES,
  CIRCUIT_BREAKER_CAPABILITIES_MAPPING,
  HomeyCircuitBreakerSettings,
  TuyaCircuitBreakerSettings,
} from './TuyaCircuitBreakerConstants';
import * as CircuitBreakerMigrations from '../../lib/migrations/CircuitBreakerMigrations';

export default class TuyaOAuth2DeviceCircuitBreaker extends TuyaOAuth2Device {
  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', value => this.sendCommand({ code: 'switch', value }));
    }
  }

  async performMigrations(): Promise<void> {
    await super.performMigrations();
    await CircuitBreakerMigrations.performMigrations(this);
  }

  async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    await super.onTuyaStatus(status, changedStatusCodes);

    for (const tuyaCapability in status) {
      const homeyCapability = getFromMap(CIRCUIT_BREAKER_CAPABILITIES_MAPPING, tuyaCapability);
      const value = status[tuyaCapability];

      if (tuyaCapability === 'switch' && homeyCapability) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (
        homeyCapability &&
        tuyaCapability === 'add_ele' &&
        typeof value === 'number' &&
        changedStatusCodes.includes('add_ele')
      ) {
        const scaling = 10.0 ** parseInt(this.getSetting(`${homeyCapability}_scaling`) ?? '0');
        const current = await this.getCapabilityValue(homeyCapability);
        await this.safeSetCapabilityValue(homeyCapability, current + value / scaling);
      }

      if (constIncludes(CIRCUIT_BREAKER_CAPABILITIES.read_only_scaled, tuyaCapability) && homeyCapability) {
        const setting = `${homeyCapability}_scaling`;
        let scaling = 10.0 ** parseInt(this.getSetting(setting), 10);
        if (homeyCapability === 'measure_current') scaling *= 1000;
        await this.safeSetCapabilityValue(homeyCapability, (value as number) / scaling);
      }

      if (constIncludes(CIRCUIT_BREAKER_CAPABILITIES.setting, tuyaCapability)) {
        await this.safeSetSettingValue(tuyaCapability, value);
      }
    }
  }

  async onSettings(event: SettingsEvent<HomeyCircuitBreakerSettings>): Promise<string | void> {
    for (const tuyaCapability of CIRCUIT_BREAKER_CAPABILITIES.read_only_scaled) {
      const homeyCapability = CIRCUIT_BREAKER_CAPABILITIES_MAPPING[tuyaCapability];
      if (!homeyCapability) continue;
      await Util.handleScaleSetting(this, event, `${homeyCapability}_scaling`, homeyCapability).catch(this.error);
    }

    const tuyaSettings = filterTuyaSettings<HomeyCircuitBreakerSettings, TuyaCircuitBreakerSettings>(event, [
      'child_lock',
      'relay_status',
    ]);

    return Util.onSettings(this, tuyaSettings, this.SETTING_LABELS);
  }
}

module.exports = TuyaOAuth2DeviceCircuitBreaker;
