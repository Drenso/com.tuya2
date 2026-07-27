import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes.js';
import type { StandardFlowArgs } from '../../types/TuyaTypes.js';
import { DEHUMIDIFIER_CAPABILITIES, DEHUMIDIFIER_CAPABILITY_MAPPING } from './DehumidifierConstants.js';
import driver_compose from './driver.compose.json' with { type: 'json' };

export default class TuyaOAuth2DriverDehumidifier extends TuyaOAuth2Driver {
  protected TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.DEFUMIDIFIER] as const;

  public async onInit(): Promise<void> {
    await super.onInit();

    for (const tuyaCapability of ['child_lock', 'sleep', 'defrost', 'swing'] as const) {
      const homeyCapability = DEHUMIDIFIER_CAPABILITY_MAPPING[tuyaCapability];
      this.homey.flow
        .getActionCard(`dehumidifier_${homeyCapability}`)
        .registerRunListener((args: StandardFlowArgs) =>
          args.device.triggerCapabilityListener(homeyCapability, args.value),
        );
    }

    for (const tuyaCapability of ['mode', 'fan_speed_enum', 'dehumidify_set_enum'] as const) {
      const homeyCapability = DEHUMIDIFIER_CAPABILITY_MAPPING[tuyaCapability];
      this.addEnumActionFlowHandler(homeyCapability, `dehumidifier_${homeyCapability}`);
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
      const homeyCapability = getFromMap(DEHUMIDIFIER_CAPABILITY_MAPPING, tuyaCapability);

      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }
    }

    // Default values, since capabilitiesOptions is not filled from the capability definitions
    props.capabilitiesOptions = {
      ...props.capabilitiesOptions,
      ...driver_compose.capabilitiesOptions,
    };

    if (!specifications || !specifications.status) {
      return props;
    }

    for (const statusSpecification of specifications.status) {
      const tuyaCapability = statusSpecification.code;
      const values = JSON.parse(statusSpecification.values);
      const homeyCapability = getFromMap(DEHUMIDIFIER_CAPABILITY_MAPPING, tuyaCapability);

      if (constIncludes(DEHUMIDIFIER_CAPABILITIES.read_only_scaled, tuyaCapability)) {
        if ([0, 1, 2, 3].includes(values.scale)) {
          props.settings[`${homeyCapability}_scaling`] = `${values.scale}`;
        } else {
          this.error(`Unsupported ${tuyaCapability} scale:`, values.scale);
        }
      }

      if (
        ['mode', 'fan_speed_enum', 'dehumidify_set_enum'].includes(tuyaCapability) &&
        homeyCapability &&
        Array.isArray(values.range) &&
        values.range.length > 0
      ) {
        props.capabilitiesOptions[homeyCapability] = {
          values: (values.range as string[]).map(value => {
            const title =
              tuyaCapability === 'dehumidify_set_enum' ? `${value}%` : value.charAt(0).toUpperCase() + value.slice(1);
            return {
              id: value,
              title: title,
            };
          }),
        };
      }
    }

    return props;
  }
}
