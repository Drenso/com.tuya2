import { Device, FlowCardTriggerDevice } from 'homey';
import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import type { SettingsEvent, TuyaStatus } from '../../types/TuyaTypes';
import {
  HomeyIrrigatorSettings,
  IRRIGATOR_CAPABILITIES,
  IRRIGATOR_CAPABILITIES_MAPPING,
  IRRIGATOR_DP_ID_MAPPING,
  IRRIGATOR_SWITCH_COUNT,
} from './TuyaIrrigatorConstants';
import { computeScaleFactor, constIncludes, getFromMap, handleScaleSetting } from '../../lib/TuyaOAuth2Util';

export default class TuyaOAuth2DeviceIrrigator extends TuyaOAuth2Device {
  turnedOnFlowCard!: FlowCardTriggerDevice;
  turnedOffFlowCard!: FlowCardTriggerDevice;

  async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    this.turnedOnFlowCard = this.homey.flow.getDeviceTriggerCard('irrigator_sub_switch_turned_on');
    this.turnedOffFlowCard = this.homey.flow.getDeviceTriggerCard('irrigator_sub_switch_turned_off');

    if (this.hasCapability('onoff')) {
      this.registerCapabilityListener('onoff', value => {
        const tuyaSwitches = this.getStore().tuya_switches;
        if (tuyaSwitches && tuyaSwitches.length > 0) {
          return this.allOnOff(value);
        }
        return this.sendCommand({ code: 'switch', value });
      });
    }

    for (let switch_i = 1; switch_i <= IRRIGATOR_SWITCH_COUNT; switch_i++) {
      if (this.hasCapability(`onoff.switch_${switch_i}`)) {
        this.registerCapabilityListener(`onoff.switch_${switch_i}`, value =>
          this.switchOnOff(value, `switch_${switch_i}`),
        );
      }
    }
  }

  async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
    // Resolve numeric DP IDs to named codes (e.g. DP 49 → rain_sensor_state)
    for (const [dpId, code] of Object.entries(IRRIGATOR_DP_ID_MAPPING)) {
      if (dpId in status) {
        status[code] = status[dpId];
        delete status[dpId];
        const idx = changedStatusCodes.indexOf(dpId);
        if (idx !== -1) {
          changedStatusCodes[idx] = code;
        }
      }
    }

    await super.onTuyaStatus(status, changedStatusCodes);

    // Handle numbered switches
    let anySwitchOn = false;
    let hasNumberedSwitches = false;

    for (let switch_i = 1; switch_i <= IRRIGATOR_SWITCH_COUNT; switch_i++) {
      const tuyaCapability = `switch_${switch_i}`;
      const switchStatus = status[tuyaCapability];
      const switchCapability = `onoff.switch_${switch_i}`;

      if (typeof switchStatus === 'boolean') {
        hasNumberedSwitches = true;
        anySwitchOn = anySwitchOn || switchStatus;

        // Trigger the appropriate flow only when the status actually changed
        if (changedStatusCodes.includes(tuyaCapability)) {
          const triggerCard = switchStatus ? this.turnedOnFlowCard : this.turnedOffFlowCard;
          triggerCard
            .trigger(
              this as Device,
              {},
              {
                tuyaCapability: tuyaCapability,
              },
            )
            .catch(this.error);
        }

        await this.safeSetCapabilityValue(switchCapability, switchStatus);
      }
    }

    if (hasNumberedSwitches) {
      await this.safeSetCapabilityValue('onoff', anySwitchOn);
    }

    for (const tuyaCapability in status) {
      const homeyCapability = getFromMap(IRRIGATOR_CAPABILITIES_MAPPING, tuyaCapability);
      const value = status[tuyaCapability];

      if (
        (constIncludes(IRRIGATOR_CAPABILITIES.read_only, tuyaCapability) ||
          constIncludes(IRRIGATOR_CAPABILITIES.read_write, tuyaCapability)) &&
        homeyCapability
      ) {
        await this.safeSetCapabilityValue(homeyCapability, value);
      }

      if (constIncludes(IRRIGATOR_CAPABILITIES.read_only_scaled, tuyaCapability) && homeyCapability) {
        const scaling = computeScaleFactor(this.getSetting(`${homeyCapability}_scaling`));
        await this.safeSetCapabilityValue(homeyCapability, (value as number) / scaling);
      }

      if (tuyaCapability === 'rain_sensor_state' && homeyCapability) {
        const isRaining = value === 'rain';
        await this.safeSetCapabilityValue(homeyCapability, isRaining);
        if (changedStatusCodes.includes(tuyaCapability)) {
          await this.homey.flow
            .getDeviceTriggerCard(`irrigator_rain_sensor_${isRaining}`)
            .trigger(this)
            .catch(this.error);
        }
      }

      if (['rain_battery_percentage', 'temp_hum_battery_percentage'].includes(tuyaCapability)) {
        await this.homey.flow
          .getDeviceTriggerCard(`irrigator_${homeyCapability}_changed`)
          .trigger(this, { value: status[tuyaCapability] })
          .catch(this.error);
      }
    }
  }

  async allOnOff(value: boolean): Promise<void> {
    const tuyaSwitches = this.getStore().tuya_switches;
    const commands = [];

    for (const tuyaSwitch of tuyaSwitches) {
      commands.push({
        code: tuyaSwitch,
        value: value,
      });
    }

    await this.sendCommands(commands);
  }

  async switchOnOff(value: boolean, tuya_switch: string): Promise<void> {
    await this.sendCommand({
      code: tuya_switch,
      value: value,
    });
  }

  async onSettings(event: SettingsEvent<HomeyIrrigatorSettings>): Promise<string | void> {
    for (const tuyaCapability of IRRIGATOR_CAPABILITIES.read_only_scaled) {
      const homeyCapability = IRRIGATOR_CAPABILITIES_MAPPING[tuyaCapability];
      await handleScaleSetting(this, event, `${homeyCapability}_scaling`, homeyCapability).catch(this.error);
    }
  }
}

module.exports = TuyaOAuth2DeviceIrrigator;
