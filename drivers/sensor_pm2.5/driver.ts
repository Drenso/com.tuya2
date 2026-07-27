import TuyaOAuth2DriverSensor from '../../lib/sensor/TuyaOAuth2DriverSensor.js';
import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import type { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse
} from '../../types/TuyaApiTypes.js';
import { CLIMATE_SENSOR_CAPABILITIES } from '../sensor_climate/TuyaClimateSensorConstants.js';
import { SENSOR_PM25_CAPABILITY_MAPPING } from './SensorPm25Constants.js';

export default class TuyaOAuth2DriverSensorPM25 extends TuyaOAuth2DriverSensor {
  TUYA_DEVICE_CATEGORIES = [
    DEVICE_CATEGORIES.SECURITY_VIDEO_SURV.PM25_DETECTOR,
    DEVICE_CATEGORIES.UNDOCUMENTED.PM25,
  ] as const;

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;
      const homeyCapability = getFromMap(SENSOR_PM25_CAPABILITY_MAPPING, tuyaCapability);

      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }
    }

    if (!specifications || !specifications.status) {
      return props;
    }

    for (const specification of specifications.status) {
      const tuyaCapability = specification.code;
      const values = JSON.parse(specification.values);
      const homeyCapability = getFromMap(SENSOR_PM25_CAPABILITY_MAPPING, tuyaCapability);

      if (tuyaCapability === 'pm25_state') {
        if (!values.range.includes('normal')) {
          props.settings['use_alarm_timeout'] = true;
        }
      }

      if (constIncludes(CLIMATE_SENSOR_CAPABILITIES.read_only_scaled, tuyaCapability)) {
        if ([0, 1, 2, 3].includes(values.scale)) {
          props.settings[`${homeyCapability}_scaling`] = `${values.scale}`;
        } else {
          this.error(`Unsupported ${tuyaCapability} scale:`, values.scale);
        }
      }
    }

    return props;
  }
};
