import TuyaOAuth2DeviceSocket from '../../drivers/socket/device.js';
import { executeMigration } from './MigrationStore.js';

export async function performMigrations(device: TuyaOAuth2DeviceSocket): Promise<void> {
  await energyScalingSettingMigration(device).catch(device.error);
}

async function energyScalingSettingMigration(device: TuyaOAuth2DeviceSocket): Promise<void> {
  await executeMigration(device, 'socket_energy_scaling', async () => {
    device.log('Migrating energy scaling setting...');

    const deviceSpecs =
      (await device.oAuth2Client
        .getSpecification(device.data.deviceId)
        .catch(e => device.log('Device specification retrieval failed', e))) ?? undefined;

    let scale: '0' | '1' | '2' | '3' | undefined;

    if (deviceSpecs?.status !== undefined) {
      for (const statusSpecification of deviceSpecs.status) {
        const tuyaCapability = statusSpecification.code;
        const values: Record<string, 0 | 1 | 2 | 3> = JSON.parse(statusSpecification.values);
        if (tuyaCapability === 'add_ele') {
          if (([0, 1, 2, 3] as const).includes(values.scale)) {
            scale = `${values.scale}`;
          } else {
            device.error('Unsupported energy scale:', values.scale);
          }
        }
      }
    }

    if (scale !== undefined) {
      await device.safeSetSettingValue('meter_power_scaling', scale);
      device.log('Energy scaling set:', scale);
      if (scale !== '0') {
        const originalValue = device.getCapabilityValue('meter_power');
        device.log('Scale factor not equal to 1, resetting meter_power from:', originalValue);
        await device.safeSetSettingValue('meter_power', 0);
      }
    } else {
      device.log('Energy scaling left at default');
    }
  });
}
