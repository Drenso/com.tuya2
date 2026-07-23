import { executeMigration } from './MigrationStore';
import TuyaOAuth2DeviceFan from '../../drivers/fan/device';
import { DEVICE_CATEGORIES } from '../TuyaOAuth2Constants';

export async function performMigrations(device: TuyaOAuth2DeviceFan): Promise<void> {
  await tuyaCapabilitiesMigration(device).catch(device.error);
  await fanDirectionMigration(device).catch(device.error);
  await fanSpeedStepsMigration(device).catch(err =>
    device.error('Error while performing fan speed steps migration:', err),
  );
}

async function tuyaCapabilitiesMigration(device: TuyaOAuth2DeviceFan): Promise<void> {
  await executeMigration(device, 'fan_tuya_capabilities', async () => {
    device.log('Migrating Tuya capabilities...');

    const tuyaCapabilities = [];

    const status = await device.getStatus();
    for (const statusEntry of status) {
      const tuyaCapability = statusEntry.code;
      if (tuyaCapability === 'switch' || tuyaCapability === 'fan_speed_percent') {
        tuyaCapabilities.push(tuyaCapability);
      }
    }

    await device.setStoreValue('tuya_capabilities', tuyaCapabilities);

    device.log('Tuya capabilities added:', tuyaCapabilities);
  });
}

async function fanDirectionMigration(device: TuyaOAuth2DeviceFan): Promise<void> {
  await executeMigration(device, 'reversed_fan_direction', async () => {
    device.log('Migrating reverse fan direction...');

    // Default value
    let reverseFanDirection = 'backward';

    const deviceSpecs =
      (await device.oAuth2Client
        .getSpecification(device.data.deviceId)
        .catch(e => device.log('Device specification retrieval failed', e))) ?? undefined;

    if (deviceSpecs?.status !== undefined) {
      for (const statusSpecification of deviceSpecs.status) {
        const tuyaCapability = statusSpecification.code;
        const values: Record<string, unknown> = JSON.parse(statusSpecification.values);
        if (tuyaCapability === 'fan_direction') {
          reverseFanDirection = (values.range as string[])[1];
          break;
        }
      }
    }

    await device.setStoreValue('reversed_fan_direction', reverseFanDirection);

    device.log('Tuya reverse fan direction set:', reverseFanDirection);
  });
}

async function fanSpeedStepsMigration(device: TuyaOAuth2DeviceFan): Promise<void> {
  await executeMigration(device, 'fan_speed_steps', async () => {
    device.log('Migrating fan speed steps...');

    let fanSpeedTuyaCapability = '';

    const status = await device.getStatus();
    for (const statusEntry of status) {
      const tuyaCapability = statusEntry.code;
      if (tuyaCapability === 'fan_speed' || tuyaCapability === 'fan_speed_percent') {
        fanSpeedTuyaCapability = tuyaCapability;
      }
    }

    await device.setStoreValue('fan_speed_tuya_capability', fanSpeedTuyaCapability);

    const deviceSpecs =
      (await device.oAuth2Client
        .getSpecification(device.data.deviceId)
        .catch(e => device.log('Device specification retrieval failed', e))) ?? undefined;

    if (deviceSpecs?.status !== undefined) {
      for (const statusSpecification of deviceSpecs.status) {
        const tuyaCapability = statusSpecification.code;
        if (tuyaCapability !== fanSpeedTuyaCapability) {
          continue;
        }
        const values: Record<string, unknown> = JSON.parse(statusSpecification.values);
        const speeds = values.range as string[] | undefined;
        const { min = 1, max = 100, step = 1, scale = 0 } = values as Record<string, number | undefined>;

        if (speeds !== undefined) {
          const legacyFanSpeedsEnum = speeds.map(value => ({
            id: value,
            title: value,
          }));
          if (device.hasCapability('fan_speed')) {
            await device.removeCapability('fan_speed');
          }
          if (!device.hasCapability('legacy_fan_speed')) {
            await device.addCapability('legacy_fan_speed');
          }
          await device.setCapabilityOptions('legacy_fan_speed', {
            values: legacyFanSpeedsEnum,
          });
        } else {
          await device.setStoreValue('fan_speed_scale', { min, max, step, scale });
          const scaledMax = max * 10 ** scale;

          if (scaledMax === 100) {
            if (device.hasCapability('legacy_fan_speed')) {
              await device.addCapability('legacy_fan_speed');
            }
            if (!device.hasCapability('fan_speed')) {
              await device.removeCapability('fan_speed');
            }
            // Homey has hardcoded 0-1 range, so scale accordingly
            const scaledStep = step / (max - min);
            await device.setCapabilityOptions('fan_speed', {
              step: scaledStep,
            });
          } else {
            const legacyFanSpeedsEnum = [];
            for (let speed = min; speed <= max; speed += step) {
              const speedPrecision = Math.max(0, -Math.floor(Math.log10(step)));
              const speedString = speed.toFixed(speedPrecision);
              legacyFanSpeedsEnum.push({
                id: speedString,
                title: speedString,
              });
            }
            if (device.hasCapability('fan_speed')) {
              await device.removeCapability('fan_speed');
            }
            if (!device.hasCapability('legacy_fan_speed')) {
              await device.addCapability('legacy_fan_speed');
            }
            await device.setCapabilityOptions('legacy_fan_speed', {
              values: legacyFanSpeedsEnum,
            });
          }
        }

        break;
      }
    } else {
      // Assume the spec defaults
      if (
        fanSpeedTuyaCapability === 'fan_speed' &&
        device.store.tuya_category !== DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT
      ) {
        const legacyFanSpeedsEnum = ['1', '2', '3', '4'].map(value => ({
          id: value,
          title: value,
        }));
        if (device.hasCapability('fan_speed')) {
          await device.removeCapability('fan_speed');
        }
        if (!device.hasCapability('legacy_fan_speed')) {
          await device.addCapability('legacy_fan_speed');
        }
        await device.setCapabilityOptions('legacy_fan_speed', {
          values: legacyFanSpeedsEnum,
        });
      }

      if (
        (fanSpeedTuyaCapability === 'fan_speed' &&
          device.store.tuya_category === DEVICE_CATEGORIES.LIGHTING.CEILING_FAN_LIGHT) ||
        fanSpeedTuyaCapability === 'fan_speed_percent'
      ) {
        await device.setStoreValue('fan_speed_scale', { min: 1, max: 100, step: 1, scale: 0 });
        if (device.hasCapability('legacy_fan_speed')) {
          await device.addCapability('legacy_fan_speed');
        }
        if (!device.hasCapability('fan_speed')) {
          await device.removeCapability('fan_speed');
        }
        await device.setCapabilityOptions('fan_speed', {
          step: 0.01,
        });
      }
    }
  });
}
