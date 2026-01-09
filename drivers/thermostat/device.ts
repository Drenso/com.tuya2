import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import * as Util from '../../lib/TuyaOAuth2Util';
import { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes';
import { constIncludes, filterTuyaSettings, getFromMap, computeScaleFactor } from '../../lib/TuyaOAuth2Util';
import {
  HomeyThermostatSettings,
  THERMOSTAT_CAPABILITIES,
  THERMOSTAT_CAPABILITIES_MAPPING,
  THERMOSTAT_FLOWS,
  TuyaThermostatSettings,
} from './TuyaThermostatConstants';
import * as TuyaThermostatMigrations from '../../lib/migrations/TuyaThermostatMigrations';

export default class TuyaOAuth2DeviceThermostat extends TuyaOAuth2Device {
  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    for (const tuyaCapability of THERMOSTAT_CAPABILITIES.read_write) {
      const homeyCapability = THERMOSTAT_CAPABILITIES_MAPPING[tuyaCapability];
      if (this.hasCapability(homeyCapability)) {
        this.registerCapabilityListener(homeyCapability, value => this.sendCommand({ code: tuyaCapability, value }));
      }
    }

    if (this.hasCapability('target_temperature')) {
      this.registerCapabilityListener('target_temperature', value => {
        const scaling = computeScaleFactor(this.getSetting('target_temperature_scaling'));
        return this.sendCommand({ code: 'temp_set', value: Math.round(value * scaling) });
      });
    }
  }

  async performMigrations(): Promise<void> {
    await super.performMigrations();
    await TuyaThermostatMigrations.performMigrations(this);
  }

  async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];
      const homeyCapability = getFromMap(THERMOSTAT_CAPABILITIES_MAPPING, tuyaCapability);

      if (
        constIncludes(THERMOSTAT_CAPABILITIES.read_write, tuyaCapability) ||
        constIncludes(THERMOSTAT_CAPABILITIES.read_only, tuyaCapability)
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(THERMOSTAT_CAPABILITIES.read_scaled, tuyaCapability)) {
        const scaling = computeScaleFactor(this.getSetting(`${homeyCapability}_scaling`));
        await this.safeSetCapabilityValue(homeyCapability, (value as number) / scaling);
      }

      if (constIncludes(THERMOSTAT_CAPABILITIES.setting, tuyaCapability)) {
        await this.safeSetSettingValue(tuyaCapability, value);
      }

      if (tuyaCapability === 'work_state' && !this.hasTuyaCapability('mode')) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }
    }

    for (const tuyaCapability of changed) {
      if (constIncludes(THERMOSTAT_FLOWS.boolean_capability_trigger, tuyaCapability)) {
        const value = status[tuyaCapability] as boolean;
        const homeyCapability = getFromMap(THERMOSTAT_CAPABILITIES_MAPPING, tuyaCapability);
        await this.homey.flow
          .getDeviceTriggerCard(`thermostat_${homeyCapability}_${value}`)
          .trigger(this)
          .catch(this.error);
      }
    }
  }

  async scaleCapabilityOptions(
    event: SettingsEvent<HomeyThermostatSettings>,
    homeyCapability: 'target_temperature' | 'measure_temperature',
  ): Promise<void> {
    const settingKey = `${homeyCapability}_scaling` as const;
    if (event.changedKeys.includes(settingKey)) {
      const unscaledRange: { min: number; max: number } = this.store[`${homeyCapability}_range`];
      const capabilityOptions: { min: number; max: number } = this.getCapabilityOptions(homeyCapability);
      const newScaling = computeScaleFactor(event.newSettings[settingKey]);
      capabilityOptions.min = unscaledRange.min / newScaling;
      capabilityOptions.max = unscaledRange.max / newScaling;
      await this.setCapabilityOptions(homeyCapability, capabilityOptions);
    }
  }

  async onSettings(event: SettingsEvent<HomeyThermostatSettings>): Promise<string | void> {
    for (const homeyCapability of [
      'target_temperature',
      'measure_temperature',
      'measure_humidity',
      'measure_power',
    ] as const) {
      await Util.handleScaleSetting(this, event, `${homeyCapability}_scaling`, homeyCapability).catch(this.error);
    }

    for (const homeyCapability of ['target_temperature', 'measure_temperature'] as const) {
      await this.scaleCapabilityOptions(event, homeyCapability).catch(this.error);
    }

    const tuyaSettings = filterTuyaSettings<HomeyThermostatSettings, TuyaThermostatSettings>(
      event,
      THERMOSTAT_CAPABILITIES.setting,
    );

    return Util.onSettings(this, tuyaSettings, this.SETTING_LABELS);
  }
}

module.exports = TuyaOAuth2DeviceThermostat;
