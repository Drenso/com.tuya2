import type { TuyaCommand } from '../types/TuyaApiTypes.js';
import type { ParsedColourData, TuyaStatus } from '../types/TuyaTypes.js';
import TuyaOAuth2Device from './TuyaOAuth2Device.js';
import { hasJsonStructure } from './TuyaOAuth2Util.js';

/**
 * Handles all light-related capabilities, except onoff
 */
export default class TuyaOAuth2DeviceWithLight extends TuyaOAuth2Device {
  protected LIGHT_DIM_CAPABILITY = 'dim';

  protected LIGHT_DIM_TUYA_CAPABILITY = 'bright_value';
  protected LIGHT_TEMP_TUYA_CAPABILITY = 'temp_value';
  protected LIGHT_COLOR_TUYA_CAPABILITY = 'colour_data';

  protected LIGHT_DIM_TUYA_SPECS = 'tuya_brightness';
  protected LIGHT_TEMP_TUYA_SPECS = 'tuya_temperature';
  protected LIGHT_COLOR_TUYA_SPECS = 'tuya_colour';

  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    // light capabilities
    const lightCapabilities = [
      this.LIGHT_DIM_CAPABILITY,
      'light_hue',
      'light_saturation',
      'light_temperature',
      'light_mode',
    ].filter(lightCapability => this.hasCapability(lightCapability));

    if (lightCapabilities.length > 0) {
      this.registerMultipleCapabilityListener(
        lightCapabilities,
        capabilityValues => this.onCapabilitiesLight(capabilityValues),
        150,
      );
    }
  }

  public async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    await super.onTuyaStatus(status, changedStatusCodes);

    // Light
    const workMode = status['work_mode'] as 'white' | 'colour' | string | undefined;
    const lightTemp = status[this.LIGHT_TEMP_TUYA_CAPABILITY] as number | undefined;
    const lightDim = status[this.LIGHT_DIM_TUYA_CAPABILITY] as number | undefined;
    const unparsedLightColor = status[this.LIGHT_COLOR_TUYA_CAPABILITY];
    const lightColor = (
      typeof unparsedLightColor === 'string' && hasJsonStructure(unparsedLightColor)
        ? JSON.parse(unparsedLightColor)
        : status[this.LIGHT_COLOR_TUYA_CAPABILITY]
    ) as ParsedColourData | undefined | string;

    if (workMode === 'white') {
      await this.safeSetCapabilityValue('light_mode', 'temperature');
    } else if (workMode === 'colour') {
      await this.safeSetCapabilityValue('light_mode', 'color');
    } else {
      await this.safeSetCapabilityValue('light_mode', null);
    }

    if (lightTemp) {
      const specs = this.store[this.LIGHT_TEMP_TUYA_SPECS];
      const light_temperature = 1 - (lightTemp - specs.min) / (specs.max - specs.min);
      await this.safeSetCapabilityValue('light_temperature', light_temperature);
    }

    if (lightDim && (workMode === 'white' || workMode === undefined)) {
      const specs = this.store[this.LIGHT_DIM_TUYA_SPECS];
      const dim = (lightDim - specs.min) / (specs.max - specs.min);
      await this.safeSetCapabilityValue(this.LIGHT_DIM_CAPABILITY, dim);
    }

    if (lightColor && typeof lightColor !== 'string') {
      const specs = this.store[this.LIGHT_COLOR_TUYA_SPECS];
      const h = (lightColor.h - specs.h.min) / (specs.h.max - specs.h.min);
      const s = (lightColor.s - specs.s.min) / (specs.s.max - specs.s.min);

      await this.safeSetCapabilityValue('light_hue', h);
      await this.safeSetCapabilityValue('light_saturation', s);

      if (workMode === 'colour') {
        const v = (lightColor.v - specs.v.min) / (specs.v.max - specs.v.min);
        await this.safeSetCapabilityValue(this.LIGHT_DIM_CAPABILITY, v);
      }
    }
  }

  public async onCapabilitiesLight(newValues: Record<string, unknown>): Promise<void> {
    let light_mode = newValues['light_mode'] ?? this.getCapabilityValue('light_mode');
    const light_hue = newValues['light_hue'] ?? this.getCapabilityValue('light_hue') ?? 1.0;
    const light_saturation = newValues['light_saturation'] ?? this.getCapabilityValue('light_saturation') ?? 1.0;
    const light_temperature = newValues['light_temperature'] ?? this.getCapabilityValue('light_temperature') ?? 1.0;
    const light_dim = newValues[this.LIGHT_DIM_CAPABILITY] ?? this.getCapabilityValue(this.LIGHT_DIM_CAPABILITY) ?? 1.0;

    const commands: TuyaCommand[] = [];

    if (!light_mode) {
      if (this.hasCapability('light_hue')) {
        light_mode = 'color';
      } else {
        light_mode = 'temperature';
      }
    }

    if (this.hasTuyaCapability('work_mode')) {
      commands.push({
        code: 'work_mode',
        value: light_mode === 'color' ? 'colour' : 'white',
      });
    }

    if (light_mode === 'color') {
      const specs = this.store[this.LIGHT_COLOR_TUYA_SPECS];
      const h = Math.round(specs.h.min + light_hue * (specs.h.max - specs.h.min));
      const s = Math.round(specs.s.min + light_saturation * (specs.s.max - specs.s.min));
      const v = Math.round(specs.v.min + light_dim * (specs.v.max - specs.v.min));

      commands.push({
        code: this.LIGHT_COLOR_TUYA_CAPABILITY,
        value: { h, s, v },
      });
    } else {
      // Dim
      if (light_dim && this.hasTuyaCapability(this.LIGHT_DIM_TUYA_CAPABILITY)) {
        const specs = this.store[this.LIGHT_DIM_TUYA_SPECS];
        const brightValue = Math.round(specs.min + light_dim * (specs.max - specs.min));

        commands.push({
          code: this.LIGHT_DIM_TUYA_CAPABILITY,
          value: brightValue,
        });
      }

      // Temperature
      if (light_temperature && this.hasTuyaCapability(this.LIGHT_TEMP_TUYA_CAPABILITY)) {
        const specs = this.store[this.LIGHT_TEMP_TUYA_SPECS];
        const tempValue = Math.round(specs.min + (1 - light_temperature) * (specs.max - specs.min));

        commands.push({
          code: this.LIGHT_TEMP_TUYA_CAPABILITY,
          value: tempValue,
        });
      }
    }

    if (commands.length) {
      await this.sendCommands(commands);
    }
  }
}
