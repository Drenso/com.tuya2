import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import TuyaOAuth2Driver, { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver';
import { fillTranslatableObject, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes';
import type { StandardFlowArgs, Translation } from '../../types/TuyaTypes';
import { SPA_CAPABILITIES_MAPPING, SPA_SUB_SWITCHES } from './TuyaSpaConstants';
import { fahrenheitToCelsius } from './TuyaSpaUtil';
import TRANSLATIONS from './translations.json';

module.exports = class TuyaOAuth2DriverSpa extends TuyaOAuth2Driver {
  TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.LARGE_HOME_APPLIANCES.HEATER] as const;

  async onInit(): Promise<void> {
    await super.onInit();

    const subSwitchCards: Record<string, string> = {
      spa_set_heater: 'onoff.heater',
      spa_set_bubble: 'onoff.bubble',
      spa_set_filter: 'onoff.filter',
    };

    for (const [cardId, capability] of Object.entries(subSwitchCards)) {
      this.homey.flow
        .getActionCard(cardId)
        .registerRunListener((args: StandardFlowArgs) => args.device.triggerCapabilityListener(capability, args.value));
    }

    const conditionCards: Record<string, string> = {
      spa_heater_is_on: 'onoff.heater',
      spa_bubble_is_on: 'onoff.bubble',
      spa_filter_is_on: 'onoff.filter',
    };

    for (const [cardId, capability] of Object.entries(conditionCards)) {
      this.homey.flow
        .getConditionCard(cardId)
        .registerRunListener((args: { device: { getCapabilityValue: (c: string) => boolean } }) =>
          args.device.getCapabilityValue(capability),
        );
    }

    // "An error is active" condition: true when the fault capability holds a value.
    this.homey.flow
      .getConditionCard('spa_has_fault')
      .registerRunListener(
        (args: { device: { getCapabilityValue: (c: string) => string | null } }) =>
          !!args.device.getCapabilityValue('fault'),
      );

    // "Heating status is X" condition.
    this.homey.flow
      .getConditionCard('spa_heat_state_is')
      .registerRunListener(
        (args: { device: { getCapabilityValue: (c: string) => string | null }; state: string }) =>
          args.device.getCapabilityValue('spa_heat_state') === args.state,
      );
  }

  // Category `rs` is shared with regular heaters/heat pumps. Only treat a device
  // as a spa when it exposes the spa-specific DP codes, so heaters keep working.
  onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
    if (!super.onTuyaPairListDeviceFilter(device)) {
      return false;
    }

    return (device.status ?? []).some(
      status => status.code === 'power_switch' || status.code === 'bubble_switch',
    );
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;

      // Single-value capabilities
      const homeyCapability = getFromMap(SPA_CAPABILITIES_MAPPING, tuyaCapability);
      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      // Boolean sub-switches (heater / bubbles / filter)
      const subCapability = getFromMap(SPA_SUB_SWITCHES, tuyaCapability);
      if (subCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(subCapability);

        const translations = TRANSLATIONS.capabilitiesOptions as Record<string, Record<string, Translation>>;
        const translation = translations[subCapability];
        if (translation) {
          props.capabilitiesOptions[subCapability] = fillTranslatableObject(translation, {});
        }
      }

      // Error / fault reporting
      if (tuyaCapability === 'error_code') {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push('fault');
      }

      // Heating status indicator (read-only)
      if (tuyaCapability === 'heat_indicator') {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push('spa_heat_state');
      }
    }

    if (!specifications || !specifications.status) {
      return props;
    }

    for (const spec of specifications.status) {
      const values = JSON.parse(spec.values);

      if (spec.code === 'tempture_set') {
        const scale = 10 ** (values.scale ?? 0);
        const isFahrenheit = values.unit === 'F' || values.unit === '℉';

        const min = values.min / scale;
        const max = values.max / scale;
        const step = values.step / scale;

        // Homey target_temperature is expressed in °C; convert if the device reports °F.
        props.capabilitiesOptions['target_temperature'] = isFahrenheit
          ? {
              min: Math.round(fahrenheitToCelsius(min) * 2) / 2,
              max: Math.round(fahrenheitToCelsius(max) * 2) / 2,
              step: 0.5,
            }
          : { min, max, step };

        props.store.tuya_temperature_unit = isFahrenheit ? 'F' : 'C';
      }

      // Store the bitmap labels so reported error codes can be mapped to readable values.
      if (spec.code === 'error_code' && Array.isArray(values.label)) {
        props.store.tuya_spa_error_labels = [...values.label];
      }
    }

    return props;
  }
};
