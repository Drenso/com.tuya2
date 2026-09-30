import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import type { TuyaStatus } from '../../types/TuyaTypes.js';

const VALUE_MAP: Record<string, string> = {
  single_click: 'pressed',
  double_click: 'double_clicked',
  long_press: 'long_pressed',
  click: 'clicked',
};

export default class TuyaOAuth2DeviceButton extends TuyaOAuth2Device {
  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();
  }

  public async onTuyaStatus(status: TuyaStatus, changed: string[]): Promise<void> {
    await super.onTuyaStatus(status, changed);

    for (const tuyaCapability in status) {
      const value = status[tuyaCapability];

      if ((tuyaCapability.startsWith('switch_mode') || tuyaCapability.match(/^switch\d_value$/)) && changed.includes(tuyaCapability)) {
        const triggerValue = VALUE_MAP[value as string] ?? `${value}ed`;
        await this.homey.flow
          .getDeviceTriggerCard(`button_sub_switch_${triggerValue}`)
          .trigger(
            this,
            {},
            {
              switch: { id: tuyaCapability },
            },
          )
          .catch(this.error);
      }

      if (tuyaCapability === 'knob_switch_mode_1') {
        await this.homey.flow.getDeviceTriggerCard('button_knob_turned').trigger(this, {}, { value }).catch(this.error);
      }

      if (tuyaCapability === 'battery_percentage') {
        await this.safeSetCapabilityValue('measure_battery', value);
      }
    }
  }
}
