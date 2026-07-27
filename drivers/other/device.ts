import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device.js';
import * as OtherMigrations from '../../lib/migrations/OtherMigrations.js';

export default class TuyaOAuth2DeviceOther extends TuyaOAuth2Device {
  async performMigrations(): Promise<void> {
    await super.performMigrations();
    await OtherMigrations.performMigrations(this);
  }
}
