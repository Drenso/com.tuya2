import type TuyaOAuth2DeviceCircuitBreaker from '../../drivers/circuit_breaker/device';
import { executeMigration } from './MigrationStore';

export async function performMigrations(device: TuyaOAuth2DeviceCircuitBreaker): Promise<void> {
  await addMeterPowerCapability(device).catch(device.error);
}

async function addMeterPowerCapability(device: TuyaOAuth2DeviceCircuitBreaker): Promise<void> {
  await executeMigration(device, 'meter_power_capability', async () => {
    device.log('Adding meter power capability when applicable...');
    if (device.hasCapability('meter_power')) {
      return;
    }

    if (!device.hasTuyaCapability('add_ele')) {
      return;
    }

    await device.addCapability('meter_power');
    await device.safeSetSettingValue('meter_power_scaling', '0');
  });
}
