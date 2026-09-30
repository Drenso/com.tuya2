import type { FlowCard } from 'homey';
import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants.js';
import TuyaOAuth2Driver, { type ListDeviceProperties } from '../../lib/TuyaOAuth2Driver.js';
import type {
  TuyaDeviceDataPointResponse,
  TuyaDeviceResponse,
  TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes.js';
import type { StandardDeviceFlowArgs, StandardValueFlowArgs } from '../../types/TuyaTypes.js';

type SwitchArgs = { switch: { id: string } };

export default class TuyaOAuth2DriverButton extends TuyaOAuth2Driver {
  protected TUYA_DEVICE_CATEGORIES = [
    DEVICE_CATEGORIES.ELECTRICAL_PRODUCTS.WIRELESS_SWITCH,
    DEVICE_CATEGORIES.ELECTRICAL_PRODUCTS.SCENE_SWITCH,
  ] as const;

  public async onInit(): Promise<void> {
    await super.onInit();

    const switchAutocompleteListener = (
      query: string,
      args: StandardDeviceFlowArgs,
    ): FlowCard.ArgumentAutocompleteResults => {
      const device = args.device;
      const tuyaSwitches = device.getStore().tuya_switches;
      return tuyaSwitches.map((tuyaCapability: string) => {
        const switch_number = tuyaCapability.substring(11);
        const name = this.homey.__('switch', { number: switch_number });
        return {
          name: name,
          id: tuyaCapability,
        };
      });
    };

    for (const trigger of ['pressed', 'clicked', 'double_clicked', 'long_pressed']) {
      this.homey.flow
        .getDeviceTriggerCard(`button_sub_switch_${trigger}`)
        .registerArgumentAutocompleteListener('switch', (query: string, args: StandardDeviceFlowArgs) =>
          switchAutocompleteListener(query, args),
        )
        .registerRunListener((args: SwitchArgs, state: SwitchArgs) => args.switch.id === state.switch.id);
    }

    this.homey.flow
      .getDeviceTriggerCard('button_knob_turned')
      .registerRunListener((args: StandardValueFlowArgs, state: StandardValueFlowArgs) => args.value === state.value);
  }

  protected onTuyaPairListDeviceProperties(
    device: TuyaDeviceResponse,
    specifications?: TuyaDeviceSpecificationResponse,
    dataPoints?: TuyaDeviceDataPointResponse,
  ): ListDeviceProperties {
    const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);
    props.store.tuya_switches = [];

    for (const status of device.status) {
      const tuyaCapability = status.code;

      if (tuyaCapability.startsWith('switch_mode') || tuyaCapability.match(/^switch\d_value$/)) {
        props.store.tuya_switches.push(tuyaCapability);
        props.store.tuya_capabilities.push(tuyaCapability);
      }

      if (tuyaCapability === 'battery_percentage') {
        props.capabilities.push('measure_battery');
        props.store.tuya_capabilities.push(tuyaCapability);
      }

      if (tuyaCapability === 'knob_switch_mode_1') {
        props.capabilities.push('hidden.knob_switch_mode_1');
        props.store.tuya_capabilities.push(tuyaCapability);
      }
    }

    return props;
  }
}
