import TuyaOAuth2DeviceSensor from '../../lib/sensor/TuyaOAuth2DeviceSensor.js';
import { type HomeySensorSettings, SENSOR_SETTING_LABELS } from '../../lib/sensor/TuyaSensorConstants.js';
import * as Util from '../../lib/TuyaOAuth2Util.js';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes.js';

export default class TuyaOAuth2DeviceSensorSmoke extends TuyaOAuth2DeviceSensor {
  async onOAuth2Init(): Promise<void> {
    await this.initAlarm('alarm_smoke').catch(this.error);

    return super.onOAuth2Init();
  }

  async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    await super.onTuyaStatus(status, changedStatusCodes);

    // alarm_smoke
    if (
      typeof status['smoke_sensor_status'] === 'string' &&
      (!this.getSetting('use_alarm_timeout') || changedStatusCodes.includes('smoke_sensor_status'))
    ) {
      this.setAlarmCapabilityValue('alarm_smoke', status['smoke_sensor_status'] === 'alarm').catch(this.error);
    }
  }

  async onSettings(event: SettingsEvent<HomeySensorSettings>): Promise<string | void> {
    const [unsupportedSettings, unsupportedValues] = await super.onAlarmSettings(event);
    return Util.reportUnsupportedSettings(this, unsupportedSettings, unsupportedValues, SENSOR_SETTING_LABELS);
  }
}
