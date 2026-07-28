import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import type TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import { getFromMap } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes.js';
import { AIRCO_CAPABILITIES_MAPPING, AIRCO_MODE_LABEL_MAPPING } from './TuyaAircoConstants.js';

type DeviceArgs = { device: TuyaOAuth2Device };
type ValueArgs = { value: unknown };

export default class TuyaOAuth2DriverAirco extends TuyaOAuth2Driver {
  protected TUYA_DEVICE_CATEGORIES = [
    DEVICE_CATEGORIES.LARGE_HOME_APPLIANCES.AIR_CONDITIONER,
    DEVICE_CATEGORIES.LARGE_HOME_APPLIANCES.AIR_CONDITIONER_CONTROLLER,
  ] as const;

  public async onInit(): Promise<void> {
    await super.onInit();

    this.homey.flow.getActionCard('airco_set_child_lock').registerRunListener(async (args: DeviceArgs & ValueArgs) => {
      await args.device.triggerCapabilityListener('child_lock', args.value);
    });
  }

  protected onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    for (const status of device.status) {
      const tuyaCapability = status.code;

      const homeyCapability = getFromMap(AIRCO_CAPABILITIES_MAPPING, tuyaCapability);
      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      if (tuyaCapability === 'lock' || tuyaCapability === 'child_lock') {
        props.store['tuya_child_lock_capability'] = tuyaCapability;
      }
    }

    const defaultThermostatModes = [];
    for (const mode in AIRCO_MODE_LABEL_MAPPING) {
      defaultThermostatModes.push({
        id: mode,
        title: AIRCO_MODE_LABEL_MAPPING[mode as keyof typeof AIRCO_MODE_LABEL_MAPPING],
      });
    }

    props.capabilitiesOptions['thermostat_mode'] = {
      values: defaultThermostatModes,
    };

    if (!specifications || !specifications.status) {
      for (const status of device.status) {
        if (status.code === 'mode') {
          props.capabilities.push('thermostat_mode');
        }
      }
      return props;
    }

    for (const spec of specifications.status) {
      const tuyaCapability = spec.code;
      const values = JSON.parse(spec.values);

      if (tuyaCapability === 'temp_set') {
        const scaleExp = values.scale ?? 0;
        const scale = 10 ** scaleExp;

        props.capabilitiesOptions['target_temperature'] = {
          step: values.step / scale,
          min: values.min / scale,
          max: values.max / scale,
        };
      }

      if (tuyaCapability === 'humidity_set') {
        const scaleExp = values.scale ?? 0;
        const scale = 10 ** scaleExp;

        props.capabilitiesOptions['target_humidity'] = {
          step: values.step / scale,
          min: values.min / scale,
          max: values.max / scale,
        };
      }

      if (['temp_set', 'temp_current', 'humidity_set', 'humidity_current'].includes(tuyaCapability)) {
        if ([0, 1, 2, 3].includes(values.scale)) {
          props.settings[`${tuyaCapability}_scaling`] = `${values.scale}`;
        } else {
          this.error(`Unsupported ${tuyaCapability} scale:`, values.scale);
        }
      }

      if (tuyaCapability === 'mode') {
        const modeRange = values.range as string[];
        if (!Array.isArray(modeRange)) {
          props.capabilities.push('thermostat_mode');
          continue;
        }

        // Do not add capability if we cannot actually switch modes
        if (modeRange.length <= 1) {
          continue;
        }

        props.capabilities.push('thermostat_mode');

        const thermostatModes = [];
        for (const mode of modeRange) {
          let label = AIRCO_MODE_LABEL_MAPPING[mode as never] as object | string | undefined;
          if (label === undefined) {
            label = mode.charAt(0).toUpperCase() + mode.slice(1);
          }
          thermostatModes.push({
            id: mode,
            title: label,
          });
        }

        props.capabilitiesOptions['thermostat_mode'] = {
          values: thermostatModes,
        };
      }
    }
    return props;
  }
}
