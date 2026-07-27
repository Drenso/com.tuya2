import TuyaDriverWithCamera from '../../lib/camera/driver.js';
import type TuyaOAuth2DeviceCamera from './device.js';

type PtzControlFlowArgs = {
  device: TuyaOAuth2DeviceCamera;
  direction: '0' | '2' | '4' | '6';
  duration: number;
};

export default class TuyaOAuth2DriverCamera extends TuyaDriverWithCamera {
  public async onInit(): Promise<void> {
    await super.onInit();

    this.homey.flow.getActionCard(`${this.id}_ptz_control`).registerRunListener(async (args: PtzControlFlowArgs) => {
      this.log(args.direction, args.duration);
      const device = args.device;
      const stopTimeout = this.homey.setTimeout(() => {
        device.sendCommand({ code: 'ptz_stop', value: true }).catch(device.error);
      }, args.duration * 1000);
      await device.sendCommand({ code: 'ptz_control', value: args.direction }).catch(err => {
        this.homey.clearTimeout(stopTimeout);
        throw err;
      });
    });
  }
}
