import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse
} from '../../types/TuyaApiTypes.js';
import { GARAGE_DOOR_CAPABILITIES, GRAGE_DOOR_CAPABILITIES_MAPPING } from './TuyaGarageDoorConstants.js';

export default class TuyaOAuth2DriverGarageDoor extends TuyaOAuth2Driver {
  TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.ELECTRICAL_PRODUCTS.GARAGE_DOOR_OPEN] as const;

  async onInit(): Promise<void> {
    await super.onInit();
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;
      const homeyCapability = getFromMap(GRAGE_DOOR_CAPABILITIES_MAPPING, tuyaCapability);

      if (
        constIncludes(GARAGE_DOOR_CAPABILITIES.read_write, tuyaCapability) ||
        constIncludes(GARAGE_DOOR_CAPABILITIES.setting, tuyaCapability)
      ) {
        props.store.tuya_capabilities.push(tuyaCapability);

        if (homeyCapability) {
          props.capabilities.push(homeyCapability);
        }
      }
    }

    return props;
  }
};
