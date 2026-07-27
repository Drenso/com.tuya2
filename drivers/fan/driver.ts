import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import type { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import TuyaOAuth2DriverWithLight from '../../lib/TuyaOAuth2DriverWithLight.js';
import { getFromMap, sendSetting } from '../../lib/TuyaOAuth2Util.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse
} from '../../types/TuyaApiTypes.js';
import type { StandardDeviceFlowArgs, StandardFlowArgs } from '../../types/TuyaTypes.js';
import TRANSLATIONS from './translations.json' with { type: 'json' };
import { FAN_CAPABILITIES_MAPPING } from './TuyaFanConstants.js';

export default class TuyaOAuth2DriverFan extends TuyaOAuth2DriverWithLight {
  TUYA_DEVICE_CATEGORIES = [
    DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.FAN,
    DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT,
  ] as const;

  async onInit(): Promise<void> {
    await super.onInit();

    this.homey.flow.getActionCard('fan_light_on').registerRunListener(async (args: StandardDeviceFlowArgs) => {
      await args.device.triggerCapabilityListener('onoff.light', true).catch(args.device.error);
    });

    this.homey.flow.getActionCard('fan_light_off').registerRunListener(async (args: StandardDeviceFlowArgs) => {
      await args.device.triggerCapabilityListener('onoff.light', false).catch(args.device.error);
    });

    this.homey.flow.getConditionCard('fan_light_is_on').registerRunListener((args: StandardDeviceFlowArgs) => {
      return args.device.getCapabilityValue('onoff.light');
    });

    this.homey.flow.getActionCard('fan_fan_direction').registerRunListener(async (args: StandardFlowArgs) => {
      if (args.value === 'backward') {
        args.value = args.device.store['reversed_fan_direction'];
      }

      await sendSetting(args.device, 'fan_direction', args.value, this.SETTING_LABELS);
    });
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    // superclass handles light capabilities, except onoff.light
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

    props.store['_migrations'] = ['fan_tuya_capabilities', 'reversed_fan_direction', 'fan_speed_steps'];

    let fanSpeedTuyaCapability = '';

    for (const status of device.status) {
      const tuyaCapability = status.code;

      const homeyCapability = getFromMap(FAN_CAPABILITIES_MAPPING, tuyaCapability);
      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      if (tuyaCapability === 'fan_speed' || tuyaCapability === 'fan_speed_percent') {
        props.store.tuya_capabilities.push(tuyaCapability);
        fanSpeedTuyaCapability = tuyaCapability;
      }

      if (tuyaCapability === 'colour_data') {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push('light_hue');
        props.capabilities.push('light_saturation');
      }
    }

    // Fix onoff when light is present
    if (props.capabilities.includes('onoff.light')) {
      props.capabilitiesOptions['onoff'] = TRANSLATIONS.capabilitiesOptions['onoff.fan'];
      props.capabilitiesOptions['onoff.light'] = TRANSLATIONS.capabilitiesOptions['onoff.light'];
    }

    props.store['reversed_fan_direction'] = 'backward';
    props.store['fan_speed_tuya_capability'] = fanSpeedTuyaCapability;

    if (!specifications || !specifications.status) {
      // Assume the spec defaults
      if (fanSpeedTuyaCapability === 'fan_speed' && device.category !== DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT) {
        const legacyFanSpeedsEnum = ['1', '2', '3', '4'].map(value => ({
          id: value,
          title: value,
        }));
        props.capabilities.push('legacy_fan_speed');
        props.capabilitiesOptions['legacy_fan_speed'] = {
          values: legacyFanSpeedsEnum,
        };
      }

      if (
        (fanSpeedTuyaCapability === 'fan_speed' && device.category === DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT) ||
        fanSpeedTuyaCapability === 'fan_speed_percent'
      ) {
        props.store['fan_speed_scale'] = { min: 1, max: 100, step: 1, scale: 0 };
        props.capabilities.push('fan_speed');
        props.capabilitiesOptions['fan_speed'] = {
          step: 0.01,
        };
      }

      return props;
    }

    for (const statusSpecification of specifications.status) {
      const tuyaCapability = statusSpecification.code;
      const values: Record<string, unknown> = JSON.parse(statusSpecification.values);

      const speeds = values.range as string[] | undefined;
      const { min = 1, max = 100, step = 1, scale = 0 } = values as Record<string, number | undefined>;

      // Fan
      if (tuyaCapability === fanSpeedTuyaCapability) {
        if (speeds !== undefined) {
          const legacyFanSpeedsEnum = speeds.map(value => ({
            id: value,
            title: value,
          }));
          props.capabilities.push('legacy_fan_speed');
          props.capabilitiesOptions['legacy_fan_speed'] = {
            values: legacyFanSpeedsEnum,
          };
        } else {
          props.store['fan_speed_scale'] = { min, max, step, scale };
          const scaledMax = max * 10 ** scale;

          if (scaledMax === 100) {
            props.capabilities.push('fan_speed');
            // Homey has hardcoded 0-1 range, so scale accordingly
            const scaledStep = step / (max - min);
            props.capabilitiesOptions['fan_speed'] = {
              step: scaledStep,
            };
          } else {
            const legacyFanSpeedsEnum = [];
            for (let speed = min; speed <= max; speed += step) {
              const speedPrecision = Math.max(0, -Math.floor(Math.log10(step)));
              const speedString = speed.toFixed(speedPrecision);
              legacyFanSpeedsEnum.push({
                id: speedString,
                title: speedString,
              });
            }
            props.capabilities.push('legacy_fan_speed');
            props.capabilitiesOptions['legacy_fan_speed'] = {
              values: legacyFanSpeedsEnum,
            };
          }
        }
      }

      if (tuyaCapability === 'fan_direction') {
        props.store['reversed_fan_direction'] = (values.range as string[])[1];
      }

      // Temperature
      if (tuyaCapability === 'temp') {
        props.capabilitiesOptions['target_temperature'] = {
          min: values.min ?? 0,
          max: values.max ?? 50,
        };
      }
      if (tuyaCapability === 'temp_current') {
        props.capabilitiesOptions['measure_temperature'] = {
          min: values.min ?? 0,
          max: values.max ?? 50,
        };
      }
    }

    return props;
  }
};
