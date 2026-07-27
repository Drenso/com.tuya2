import TuyaOAuth2DeviceSensor from '../../lib/sensor/TuyaOAuth2DeviceSensor.js';
import type { TuyaStatus } from '../../types/TuyaTypes.js';

export default class TuyaOAuth2DeviceSensorMotion extends TuyaOAuth2DeviceSensor {
  public async onOAuth2Init(): Promise<void> {
    await this.initAlarm('alarm_motion').catch(this.error);

    return super.onOAuth2Init();
  }

  public async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    await super.onTuyaStatus(status, changedStatusCodes);

    // alarm_motion
    if (
      typeof status['pir'] === 'string' &&
      (!this.getSetting('use_alarm_timeout') || changedStatusCodes.includes('pir'))
    ) {
      this.setAlarmCapabilityValue('alarm_motion', status['pir'] === 'pir').catch(this.error);
    }
  }
}
