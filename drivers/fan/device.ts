import * as TuyaFanMigrations from '../../lib/migrations/TuyaFanMigrations.js';
import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2DeviceWithLight from '../../lib/TuyaOAuth2DeviceWithLight.js';
import * as TuyaOAuth2Util from '../../lib/TuyaOAuth2Util.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';
import {
  FAN_CAPABILITIES,
  FAN_CAPABILITIES_MAPPING,
  FAN_LIGHT_CAPABILITIES_MAPPING,
  type HomeyFanSettings,
  type TuyaFanSettings,
} from './TuyaFanConstants.js';

export default class TuyaOAuth2DeviceFan extends TuyaOAuth2DeviceWithLight {
  LIGHT_DIM_CAPABILITY = 'dim';

  async onOAuth2Init(): Promise<void> {
    // superclass handles light capabilities, except onoff.light
    await super.onOAuth2Init();

    for (const [tuyaCapability, capability] of Object.entries(FAN_CAPABILITIES_MAPPING)) {
      if (
        constIncludes(FAN_CAPABILITIES.read_write, tuyaCapability) &&
        this.hasCapability(capability) &&
        this.hasTuyaCapability(tuyaCapability)
      ) {
        this.registerCapabilityListener(capability, value => this.sendCommand({ code: tuyaCapability, value }));
      }
    }

    // fan_speed
    const fanSpeedTuyaCapability = this.getStoreValue('fan_speed_tuya_capability');
    const fanSpeedRange = this.getStoreValue('fan_speed_scale') as
      | { min: number; max: number; step: number; scale: number }
      | undefined;

    if (this.hasCapability('legacy_fan_speed')) {
      this.registerCapabilityListener('legacy_fan_speed', (value: string) => {
        // parse if the tuya capability expects a numeric value
        const parsedValue = fanSpeedRange === undefined ? value : parseFloat(value);
        return this.sendCommand({
          code: fanSpeedTuyaCapability,
          value: parsedValue,
        });
      });
    }

    if (this.hasCapability('fan_speed')) {
      const { min = 0, max = 100 } = fanSpeedRange ?? {};
      this.registerCapabilityListener('fan_speed', (value: number) => {
        const scaledValue = min + value * (max - min);
        return this.sendCommand({ code: 'fan_speed', value: scaledValue });
      });
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
