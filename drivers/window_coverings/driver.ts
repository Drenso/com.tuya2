import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes.js';
import { WINDOW_COVERINGS_CAPABILITIES, WINDOW_COVERINGS_CAPABILITY_MAPPING } from './TuyaWindowCoveringsConstants.js';

export default class TuyaOAuth2DriverWindowCoverings extends TuyaOAuth2Driver {
  protected TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.CURTAIN] as const;

  protected onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;

      const homeyCapability = getFromMap(WINDOW_COVERINGS_CAPABILITY_MAPPING, tuyaCapability);
      if (constIncludes(WINDOW_COVERINGS_CAPABILITIES.read_write, tuyaCapability) && homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      if (constIncludes(WINDOW_COVERINGS_CAPABILITIES.setting, tuyaCapability) || tuyaCapability === 'percent_state') {
        props.store.tuya_capabilities.push(tuyaCapability);
      }
    }

    return props;
  }
}
