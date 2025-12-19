import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import TuyaOAuth2Driver, { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes';
import { WINDOW_COVERINGS_CAPABILITIES, WINDOW_COVERINGS_CAPABILITY_MAPPING } from './TuyaWindowCoveringsConstants';

module.exports = class TuyaOAuth2DriverWindowCoverings extends TuyaOAuth2Driver {
  TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.CURTAIN] as const;
  VIVIDSTORM_PRODUCT_IDS = ['lfkr93x0ukp5gaia'];

  onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
    if (this.VIVIDSTORM_PRODUCT_IDS.includes(device.product_id)) return true;
    return super.onTuyaPairListDeviceFilter(device);
  }

  onTuyaPairListDeviceProperties(
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
};
