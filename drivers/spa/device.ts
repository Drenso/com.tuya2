import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import { TuyaStatus } from '../../types/TuyaTypes';
import { SPA_SUB_SWITCHES } from './TuyaSpaConstants';
import { celsiusToFahrenheit, fahrenheitToCelsius } from './TuyaSpaUtil';

module.exports = class TuyaOAuth2DeviceSpa extends TuyaOAuth2Device {
  isFahrenheit(): boolean {
    return this.store?.tuya_temperature_unit === 'F';
  }

  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', value => this.sendCommand({ code: 'power_switch', value }));
    }

    if (this.hasCapability('onoff.heater')) {
      this.registerCapabilityListener('onoff.heater', value => this.sendCommand({ code: 'heater_switch', value }));
    }

    if (this.hasCapability('onoff.bubble')) {
      this.registerCapabilityListener('onoff.bubble', value => this.sendCommand({ code: 'bubble_switch', value }));
    }

    if (this.hasCapability('onoff.filter')) {
      this.registerCapabilityListener('onoff.filter', value => this.sendCommand({ code: 'filter_switch', value }));
    }

    if (this.hasCapability('target_temperature')) {
      this.registerCapabilityListener('target_temperature', value => this.targetTemperatureCapabilityListener(value));
    }
  }

  async targetTemperatureCapabilityListener(value: number): Promise<void> {
    const tuyaValue = this.isFahrenheit() ? Math.round(celsiusToFahrenheit(value)) : Math.round(value);
    await this.sendCommand({
      code: 'tempture_set',
      value: tuyaValue,
    });
  }

  async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    await super.onTuyaStatus(status, changedStatusCodes);

    if (typeof status['power_switch'] === 'boolean') {
      await this.safeSetCapabilityValue('onoff', status['power_switch']);
    }

    for (const [tuyaCapability, homeyCapability] of Object.entries(SPA_SUB_SWITCHES)) {
      if (typeof status[tuyaCapability] === 'boolean') {
        await this.safeSetCapabilityValue(homeyCapability, status[tuyaCapability]);
      }
    }

    if (typeof status['tempture_set'] === 'number') {
      const value = this.isFahrenheit() ? fahrenheitToCelsius(status['tempture_set']) : status['tempture_set'];
      await this.safeSetCapabilityValue('target_temperature', Math.round(value * 2) / 2);
    }

    if (typeof status['water_tempture'] === 'number') {
      const value = this.isFahrenheit() ? fahrenheitToCelsius(status['water_tempture']) : status['water_tempture'];
      await this.safeSetCapabilityValue('measure_temperature', Math.round(value * 10) / 10);
    }
  }
};
