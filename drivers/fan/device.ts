import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes';
import {
  FAN_CAPABILITIES,
  FAN_CAPABILITIES_MAPPING,
  FAN_LIGHT_CAPABILITIES_MAPPING,
  HomeyFanSettings,
  TuyaFanSettings,
} from './TuyaFanConstants';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util';
import * as TuyaFanMigrations from '../../lib/migrations/TuyaFanMigrations';
import TuyaOAuth2DeviceWithLight from '../../lib/TuyaOAuth2DeviceWithLight';

export default class TuyaOAuth2DeviceFan extends TuyaOAuth2DeviceWithLight {
  LIGHT_DIM_CAPABILITY = 'dim';

  private parseStoreNumber(key: string, fallback: number): number {
    const value = this.getStoreValue(key);
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private normalizeFanSpeedPercent(value: number): number {
    const min = this.parseStoreNumber('fan_speed_percent_min', 1);
    const max = this.parseStoreNumber('fan_speed_percent_max', 100);
    const step = Math.max(this.parseStoreNumber('fan_speed_percent_step', 1), 1);

    // If Homey reports fan_speed in normalized range or percentage range, scale to the Tuya min/max range.
    const scaledValue =
      value >= min && value <= max
        ? value
        : value <= 1
          ? min + value * (max - min)
          : min + (value / 100) * (max - min);

    const snappedValue = Math.round((scaledValue - min) / step) * step + min;
    return Math.min(max, Math.max(min, snappedValue));
  }

  private normalizeFanSpeedFromTuya(value: number): number {
    const min = this.parseStoreNumber('fan_speed_percent_min', 1);
    const max = this.parseStoreNumber('fan_speed_percent_max', 100);
    const step = Math.max(this.parseStoreNumber('fan_speed_percent_step', 1), 1);
    const range = max - min;

    if (range <= 0) {
      return 0;
    }

    const snappedValue = Math.round((value - min) / step) * step + min;
    const normalizedValue = (snappedValue - min) / range;
    return Math.min(1, Math.max(0, normalizedValue));
  }

  async onOAuth2Init(): Promise<void> {
    // superclass handles light capabilities, except onoff.light
    await super.onOAuth2Init();

    for (const [tuyaCapability, capability] of Object.entries(FAN_CAPABILITIES_MAPPING)) {
      if (tuyaCapability === 'fan_speed_percent') {
        continue;
      }

      if (
        constIncludes(FAN_CAPABILITIES.read_write, tuyaCapability) &&
        this.hasCapability(capability) &&
        this.hasTuyaCapability(tuyaCapability)
      ) {
        this.registerCapabilityListener(capability, value => this.sendCommand({ code: tuyaCapability, value }));
      }
    }

    // fan_speed
    if (this.hasCapability('fan_speed') && this.hasTuyaCapability('fan_speed_percent')) {
      this.registerCapabilityListener('fan_speed', value =>
        this.sendCommand({
          code: 'fan_speed_percent',
          value: this.normalizeFanSpeedPercent(Number(value)),
        }),
      );
    }

    if (this.hasCapability('legacy_fan_speed')) {
      this.registerCapabilityListener('legacy_fan_speed', value => this.sendCommand({ code: 'fan_speed', value }));
    }

    if (
      this.hasCapability('fan_speed') &&
      !this.hasTuyaCapability('fan_speed_percent') &&
      this.getStoreValue('tuya_category') === DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT
    ) {
      this.registerCapabilityListener('fan_speed', value => this.sendCommand({ code: 'fan_speed', value }));
    }
  }

  async performMigrations(): Promise<void> {
    await super.performMigrations();
    await TuyaFanMigrations.performMigrations(this);
  }

  async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    // superclass handles light capabilities, except onoff.light
    await super.onTuyaStatus(status, changedStatusCodes);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];
      const homeyCapability = getFromMap(FAN_CAPABILITIES_MAPPING, tuyaCapability);

      if (tuyaCapability === 'fan_speed_percent' && typeof value === 'number' && homeyCapability) {
        await this.safeSetCapabilityValue(homeyCapability, this.normalizeFanSpeedFromTuya(value));
        continue;
      }

      if (
        (constIncludes(FAN_CAPABILITIES.read_write, tuyaCapability) ||
          constIncludes(FAN_CAPABILITIES.read_only, tuyaCapability)) &&
        homeyCapability
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (tuyaCapability === 'fan_direction') {
        const directionValue = value === 'forward' ? 'forward' : 'backward';
        await this.safeSetSettingValue('fan_direction', directionValue);
      }

      if (tuyaCapability === 'fan_speed') {
        if (this.getStoreValue('tuya_category') === DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT) {
          await this.safeSetCapabilityValue('fan_speed', value);
        } else {
          await this.safeSetCapabilityValue('legacy_fan_speed', String(value));
        }
      }
    }

    // flows
    if (this.getSetting('enable_light_support')) {
      if (changedStatusCodes.includes('light')) {
        await this.homey.flow
          .getDeviceTriggerCard(`fan_light_onoff_${status['light']}`)
          .trigger(this)
          .catch(this.error);
      }

      if (changedStatusCodes.includes('switch_led')) {
        await this.homey.flow
          .getDeviceTriggerCard(`fan_light_onoff_${status['switch_led']}`)
          .trigger(this)
          .catch(this.error);
      }
    }
  }

  async onSettings(event: SettingsEvent<HomeyFanSettings>): Promise<string | void> {
    if (event.changedKeys.includes('enable_light_support')) {
      if (event.newSettings['enable_light_support']) {
        for (const [tuyaCapability, homeyCapability] of Object.entries(FAN_LIGHT_CAPABILITIES_MAPPING)) {
          if (this.hasTuyaCapability(tuyaCapability) && !this.hasCapability(homeyCapability)) {
            await this.addCapability(homeyCapability);
          }
        }
        if (this.hasTuyaCapability('colour')) {
          if (!this.hasCapability('light_hue')) await this.addCapability('light_hue');
          if (!this.hasCapability('light_saturation')) await this.addCapability('light_saturation');
          if (!this.hasCapability('dim')) await this.addCapability('dim');
        }
        if (this.hasCapability('light_temperature') && this.hasCapability('light_hue')) {
          if (!this.hasCapability('light_mode')) await this.addCapability('light_mode');
        }
      } else {
        for (const lightCapability of [
          'onoff.light',
          'dim',
          'light_mode',
          'light_temperature',
          'light_hue',
          'light_saturation',
        ]) {
          if (this.hasCapability(lightCapability)) await this.removeCapability(lightCapability);
        }
      }
    }

    const tuyaSettingsEvent = TuyaOAuth2Util.filterTuyaSettings<HomeyFanSettings, TuyaFanSettings>(event, [
      'fan_direction',
    ]);

    if (tuyaSettingsEvent.newSettings['fan_direction'] === 'backward') {
      tuyaSettingsEvent.newSettings['fan_direction'] = this.store['reversed_fan_direction'];
    }

    return TuyaOAuth2Util.onSettings<TuyaFanSettings>(this, tuyaSettingsEvent, this.SETTING_LABELS);
  }
}

module.exports = TuyaOAuth2DeviceFan;
