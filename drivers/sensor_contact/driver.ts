import TuyaOAuth2DriverSensor from '../../lib/sensor/TuyaOAuth2DriverSensor.js';
import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import type { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse
} from '../../types/TuyaApiTypes.js';

export default class TuyaOAuth2DriverSensorContact extends TuyaOAuth2DriverSensor {
  TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SECURITY_VIDEO_SURV.CONTACT_SENSOR] as const;

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    // alarm_contact
    const hasDoorContactState = device.status.some(({ code }) => code === 'doorcontact_state');
    if (hasDoorContactState) {
      props.store.tuya_capabilities.push('doorcontact_state');
      props.capabilities.push('alarm_contact');
    }

    return props;
  }
};
