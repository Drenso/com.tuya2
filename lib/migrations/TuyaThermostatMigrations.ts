import { executeMigration } from './MigrationStore';
import { computeScaleFactor } from '../TuyaOAuth2Util';
import TuyaOAuth2DeviceThermostat from '../../drivers/thermostat/device';

export async function performMigrations(device: TuyaOAuth2DeviceThermostat): Promise<void> {
  await thermostatCapabilitiesOptionsScalingMigration(device).catch(device.error);
}

async function thermostatCapabilitiesOptionsScalingMigration(device: TuyaOAuth2DeviceThermostat): Promise<void> {
  await executeMigration(device, 'thermostat_capabilities_options', async () => {
    device.log('Migrating thermostat capabilities options...');

    const deviceSpecs =
      (await device.oAuth2Client
        .getSpecification(device.data.deviceId)
        .catch(e => device.log('Device specification retrieval failed', e))) ?? undefined;

    if (deviceSpecs?.status !== undefined) {
      for (const statusSpecification of deviceSpecs.status) {
        const tuyaCapability = statusSpecification.code;
        const values = JSON.parse(statusSpecification.values);

        if (tuyaCapability === 'temp_set') {
          const scaling = computeScaleFactor(device.getSetting('target_temperature_scaling'));
          const capabilityOptions: { min: number; max: number } = device.getCapabilityOptions('target_temperature');
          capabilityOptions.min = (values.min ?? 5) / scaling;
          capabilityOptions.max = (values.max ?? 40) / scaling;
          await device.setCapabilityOptions('target_temperature', capabilityOptions);
          await device.setStoreValue('target_temperature_range', {
            min: values.min ?? 5,
            max: values.max ?? 40,
          });
        }

        if (tuyaCapability === 'temp_current') {
          const scaling = computeScaleFactor(device.getSetting('measure_temperature_scaling'));
          const capabilityOptions: { min: number; max: number } = device.getCapabilityOptions('measure_temperature');
          capabilityOptions.min = (values.min ?? 5) / scaling;
          capabilityOptions.max = (values.max ?? 40) / scaling;
          await device.setCapabilityOptions('measure_temperature', capabilityOptions);
          await device.setStoreValue('measure_temperature_range', {
            min: values.min ?? 5,
            max: values.max ?? 40,
          });
        }
      }
    }

    device.log('Scaled thermostat capabilities options');
  });
}
