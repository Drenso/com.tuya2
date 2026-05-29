import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import TuyaOAuth2Driver, { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver';
import { fillTranslatableObject, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes';
import type { Translation } from '../../types/TuyaTypes';
import { SPA_CAPABILITIES_MAPPING, SPA_SUB_SWITCHES } from './TuyaSpaConstants';
import { fahrenheitToCelsius } from './TuyaSpaUtil';
import TRANSLATIONS from './translations.json';

module.exports = class TuyaOAuth2DriverSpa extends TuyaOAuth2Driver {
  TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.LARGE_HOME_APPLIANCES.HEATER] as const;

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
    }

    if (!specifications || !specifications.status) {
      return props;
    }

    for (const spec of specifications.status) {
      if (spec.code !== 'tempture_set') {
        continue;
      }

      const values = JSON.parse(spec.values);
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

    return props;
  }
};
