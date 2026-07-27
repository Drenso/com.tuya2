import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes.js';
import { SIREN_CAPABILITIES_MAPPING, SIREN_FLOWS } from './TuyaSirenConstants.js';

export default class TuyaOAuth2DriverSiren extends TuyaOAuth2Driver {
  protected TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SECURITY_VIDEO_SURV.SIREN_ALARM] as const;

  public async onInit(): Promise<void> {
    await super.onInit();

    for (const setting of SIREN_FLOWS.setting) {
      this.addSettingFlowHandler(setting, this.SETTING_LABELS);
    }
  }

  protected onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;

      const homeyCapability = getFromMap(SIREN_CAPABILITIES_MAPPING, tuyaCapability);
      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      if (tuyaCapability === 'battery_state') {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push('alarm_battery');
      }
    }

    return props;
  }
}
