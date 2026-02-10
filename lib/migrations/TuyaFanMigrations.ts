import { executeMigration } from './MigrationStore';
import TuyaOAuth2DeviceFan from '../../drivers/fan/device';

export async function performMigrations(device: TuyaOAuth2DeviceFan): Promise<void> {
  await tuyaCapabilitiesMigration(device).catch(device.error);
  await fanDirectionMigration(device).catch(device.error);
  await fanSpeedPercentRangeMigration(device).catch(device.error);
}

async function tuyaCapabilitiesMigration(device: TuyaOAuth2DeviceFan): Promise<void> {
  await executeMigration(device, 'fan_tuya_capabilities', async () => {
    device.log('Migrating Tuya capabilities...');

    const tuyaCapabilities = [];

    const status = await device.getStatus();
    for (const tuyaCapability in status) {
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

function parseIntegerValue(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function getNormalizedStep(min: number, max: number, step: number): number {
  const range = max - min;
  if (range <= 0) {
    return 0.1;
  }
  return Math.max(step / range, 0.01);
}

async function fanSpeedPercentRangeMigration(device: TuyaOAuth2DeviceFan): Promise<void> {
  await executeMigration(device, 'fan_speed_percent_range', async () => {
    device.log('Migrating fan speed percent range...');

    if (!device.hasCapability('fan_speed') || !device.hasTuyaCapability('fan_speed_percent')) {
      return;
    }

    const deviceSpecs =
      (await device.oAuth2Client
        .getSpecification(device.data.deviceId)
        .catch(e => device.log('Device specification retrieval failed', e))) ?? undefined;

    const speedSpec = deviceSpecs?.status?.find(statusSpec => statusSpec.code === 'fan_speed_percent');
    if (!speedSpec?.values) {
      return;
    }

    const values: Record<string, unknown> = JSON.parse(speedSpec.values);
    const min = parseIntegerValue(values.min, 1);
    const max = parseIntegerValue(values.max, 100);
    const step = parseIntegerValue(values.step, 1);
    const normalizedStep = getNormalizedStep(min, max, step);

    await device.setStoreValue('fan_speed_percent_min', min);
    await device.setStoreValue('fan_speed_percent_max', max);
    await device.setStoreValue('fan_speed_percent_step', step);
    await device
      .setCapabilityOptions('fan_speed', {
        min: 0,
        max: 1,
        step: normalizedStep,
      })
      .catch(device.error);

    device.log('Fan speed percent range set:', { min, max, step, normalizedStep });
  });
}
