import TuyaOAuth2Device from './TuyaOAuth2Device.js';

export default class TuyaTimeOutAlarmDevice extends TuyaOAuth2Device {
  private alarmTimeouts: Record<string, NodeJS.Timeout | undefined> = {};

  protected async initAlarm(capability: string, checkResetSetting = true): Promise<void> {
    if (!this.hasCapability(capability)) {
      return;
    }

    const capabilityValue = this.getCapabilityValue(capability);
    if (typeof capabilityValue !== 'boolean') {
      // No value set, so reset it to false
      await this.setCapabilityValue(capability, false).catch(this.error);
      return;
    }

    if (!capabilityValue) {
      return;
    }

    if (!checkResetSetting || !this.getSetting('use_alarm_timeout')) {
      return;
    }

    // Still active, reset now because timeout is no longer running
    await this.setCapabilityValue(capability, false).catch(this.error);
  }

  protected async setAlarm(
    capability: string,
    onAlarmStarted: () => Promise<void>,
    onAlarmEnded: () => Promise<void>,
  ): Promise<void> {
    if (this.alarmTimeouts[capability] !== undefined) {
      // Extend the existing timeout if already running
      this.homey.clearTimeout(this.alarmTimeouts[capability]);
    } else {
      // Trigger if not
      await onAlarmStarted();
    }
    // Disable the alarm after a set time, since we only get an "on" event
    const alarmTimeout = Math.round((this.getSetting('alarm_timeout') ?? 10) * 1000);
    this.alarmTimeouts[capability] = this.homey.setTimeout(
      () => this.resetAlarm(capability, onAlarmEnded),
      alarmTimeout,
    );
  }

  protected async resetAlarm(capability: string, onAlarmEnded: () => Promise<void>): Promise<void> {
    // Clear the timeout for the next event
    const currentTimeout = this.alarmTimeouts[capability];
    this.homey.clearTimeout(currentTimeout);
    delete this.alarmTimeouts[capability];
    await onAlarmEnded();
  }
}
