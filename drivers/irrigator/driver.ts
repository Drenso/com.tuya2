import { FlowCard } from 'homey';
import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver';
import {
  type TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes';
import { constIncludes, fillTranslatableObject, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
  IRRIGATOR_CAPABILITIES,
  IRRIGATOR_CAPABILITIES_MAPPING,
  IRRIGATOR_DP_ID_MAPPING,
  IRRIGATOR_SWITCH_COUNT,
} from './TuyaIrrigatorConstants';
import type { StandardDeviceFlowArgs } from '../../types/TuyaTypes';
import type TuyaOAuth2DeviceIrrigator from './device';
import TRANSLATIONS from './translations.json';

type DeviceArgs = { device: TuyaOAuth2DeviceIrrigator };
type SwitchArgs = { switch: { name: string; id: string } };
type TuyaCapabilityState = { tuyaCapability: string };

module.exports = class TuyaOAuth2DriverIrrigator extends TuyaOAuth2Driver {
  TUYA_DEVICE_CATEGORIES = [
    DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.IRRIGATOR,
    DEVICE_CATEGORIES.UNDOCUMENTED.IRRIGATOR,
  ] as const;

  async onInit(): Promise<void> {
    await super.onInit();

    this.homey.flow
      .getConditionCard('irrigator_rain_sensor_is_true')
      .registerRunListener((args: StandardDeviceFlowArgs) => args.device.getCapabilityValue('rain_sensor'));

    const switchAutocompleteListener = (query: string, args: DeviceArgs): FlowCard.ArgumentAutocompleteResults => {
      const device = args.device;
      const tuyaSwitches = device.getStore().tuya_switches;
      return tuyaSwitches.map((value: string) => {
        const switch_number = value.substring(7);
        const name = this.homey.__('valve', { number: switch_number });
        return {
          name: name,
          id: value,
        };
      });
    };

    // Register Irrigator valve switch flows
    this.homey.flow
      .getActionCard('irrigator_sub_switch_on')
      .registerArgumentAutocompleteListener('switch', (query: string, args: DeviceArgs) =>
        switchAutocompleteListener(query, args),
      )
      .registerRunListener(async (args: DeviceArgs & SwitchArgs) => {
        await args.device.switchOnOff(true, args.switch.id).catch(err => {
          this.error(err);
          throw new Error(this.homey.__('error_setting_switch'));
        });
      });

    this.homey.flow
      .getActionCard('irrigator_sub_switch_off')
      .registerArgumentAutocompleteListener('switch', (query: string, args: DeviceArgs) =>
        switchAutocompleteListener(query, args),
      )
      .registerRunListener(async (args: DeviceArgs & SwitchArgs) => {
        await args.device.switchOnOff(false, args.switch.id).catch(err => {
          this.error(err);
          throw new Error(this.homey.__('error_setting_switch'));
        });
      });

    this.homey.flow
      .getDeviceTriggerCard('irrigator_sub_switch_turned_on')
      .registerArgumentAutocompleteListener('switch', (query: string, args: DeviceArgs) =>
        switchAutocompleteListener(query, args),
      )
      .registerRunListener(
        (args: DeviceArgs & SwitchArgs, state: TuyaCapabilityState) => args.switch.id === state.tuyaCapability,
      );

    this.homey.flow
      .getDeviceTriggerCard('irrigator_sub_switch_turned_off')
      .registerArgumentAutocompleteListener('switch', (query: string, args: DeviceArgs) =>
        switchAutocompleteListener(query, args),
      )
      .registerRunListener(
        (args: DeviceArgs & SwitchArgs, state: TuyaCapabilityState) => args.switch.id === state.tuyaCapability,
      );

    this.homey.flow
      .getConditionCard('irrigator_sub_switch_is_on')
      .registerArgumentAutocompleteListener('switch', (query: string, args: DeviceArgs) =>
        switchAutocompleteListener(query, args),
      )
      .registerRunListener((args: DeviceArgs & SwitchArgs) => {
        const homeyCapability = `onoff.switch_${args.switch.id.substring(7)}`;
        return args.device.getCapabilityValue(homeyCapability);
      });
  }

  onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);
    props.store.tuya_switches = [];
    props.capabilitiesOptions = props.capabilitiesOptions ?? {};

    for (const status of device.status) {
      const tuyaCapability = status.code;

      const homeyCapability = getFromMap(IRRIGATOR_CAPABILITIES_MAPPING, tuyaCapability);
      if (homeyCapability) {
        props.store.tuya_capabilities.push(tuyaCapability);
        props.capabilities.push(homeyCapability);
      }

      // Handle numbered switches for multi-valve devices
      for (let switch_i = 1; switch_i <= IRRIGATOR_SWITCH_COUNT; switch_i++) {
        if (tuyaCapability === `switch_${switch_i}`) {
          props.store.tuya_switches.push(tuyaCapability);
          props.store.tuya_capabilities.push(tuyaCapability);

          const switchCapability = `onoff.switch_${switch_i}`;
          props.capabilities.push(switchCapability);
          props.capabilitiesOptions[switchCapability] = fillTranslatableObject(
            TRANSLATIONS.capabilitiesOptions['onoff.subSwitch'],
            { index: `${switch_i}` },
          );
        }
      }
    }

    const switchCount = props.store.tuya_switches.length;

    if (switchCount > 1) {
      // Add master onoff before sub-capabilities
      props.capabilities.unshift('onoff');
      const translations = TRANSLATIONS.capabilitiesOptions['onoff.all'];
      props.capabilitiesOptions['onoff'] = {
        ...translations,
        preventInsights: true,
      };
    } else if (switchCount === 1) {
      // Single numbered switch: use the regular 'onoff' capability instead
      props.capabilities = props.capabilities.filter(c => !c.startsWith('onoff.switch_'));
      if (!props.capabilities.includes('onoff')) {
        props.capabilities.unshift('onoff');
      }
    }

    // Add rain_sensor capability for devices that may report undocumented DP 49
    if (!props.capabilities.includes('rain_sensor')) {
      props.store.tuya_capabilities.push('rain_sensor_state');
      props.capabilities.push('rain_sensor');
    }

    if (!specifications || !specifications.status) {
      return props;
    }

    for (const status of specifications.status) {
      const tuyaCapability = status.code;
      const values = JSON.parse(status.values);

      const homeyCapability = getFromMap(IRRIGATOR_CAPABILITIES_MAPPING, tuyaCapability);

      if (constIncludes(IRRIGATOR_CAPABILITIES.read_only_scaled, tuyaCapability)) {
        if ([0, 1, 2, 3].includes(values.scale)) {
          props.settings[`${homeyCapability}_scaling`] = `${values.scale}`;
        } else {
          this.error(`Unsupported ${homeyCapability} scale:`, values.scale);
        }
      }
    }

    return props;
  }
};
