import { TuyaStatus } from '../../types/TuyaTypes';
import { AIR_PURIFIER_CAPABILITIES, AIR_PURIFIER_CAPABILITIES_MAPPING } from './TuyaAirPurifierConstants';
import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import { getFromMap } from '../../lib/TuyaOAuth2Util';

export default class TuyaOAuth2DeviceAirPurifier extends TuyaOAuth2Device {
    async onOAuth2Init(): Promise<void> {
        await super.onOAuth2Init();

        // Register capability listeners
        for (const [tuyaCapability, homeyCapability] of Object.entries(AIR_PURIFIER_CAPABILITIES_MAPPING)) {
            // Priority: Check if Homey device supports this capability first
            if (this.hasCapability(homeyCapability)) {
                // Secondary: Check if Tuya device exposes this data point
                // AND Verify it's a writable capability (filter out read-only like pm25)
                if ((AIR_PURIFIER_CAPABILITIES.read_write as readonly string[]).includes(tuyaCapability)) {
                    if (this.hasTuyaCapability(tuyaCapability)) {
                        this.registerCapabilityListener(homeyCapability, value => {
                            let commandValue = value;
                            if (homeyCapability === 'jafanda_reset_filter') {
                                commandValue = true; // Button press
                            }
                            // Enum / Numeric handling
                            if (['jafanda_display', 'jafanda_atmosphere'].includes(homeyCapability)) {
                                commandValue = Number(value);
                            }
                            // Note: fan_mode and fan_speed are mapped to Tuya Enums which are strings,
                            // so we send them as strings (no conversion needed).
                            // Fan Mode robustness - ensure we send what Tuya expects
                            // (Assuming for now Tuya expects strings if mapping is strings, but if logic requires num, handle here)

                            return this.sendCommand({ code: tuyaCapability, value: commandValue });
                        });
                    }
                }
            }
        }
    }

    async onTuyaStatus(status: TuyaStatus, changedStatusCodes: string[]): Promise<void> {
        await super.onTuyaStatus(status, changedStatusCodes);

        for (const tuyaCapability in status) {
            const value = status[tuyaCapability];
            const homeyCapability = getFromMap(AIR_PURIFIER_CAPABILITIES_MAPPING, tuyaCapability);

            if (homeyCapability && this.hasCapability(homeyCapability)) {
                // Enum Type Conversion (Number -> String)
                // For text-based enums (fan_mode, fan_speed), ensure lowercase to match IDs
                if (['fan_speed', 'fan_mode'].includes(homeyCapability)) {
                    await this.safeSetCapabilityValue(homeyCapability, String(value).toLowerCase());
                    continue;
                }

                // For numeric-string enums (display, atmosphere), keep exact string (e.g. "0", "100")
                if (['jafanda_display', 'jafanda_atmosphere'].includes(homeyCapability)) {
                    await this.safeSetCapabilityValue(homeyCapability, String(value));
                    continue;
                }

                await this.safeSetCapabilityValue(homeyCapability, value);
            }
        }
    }
}

module.exports = TuyaOAuth2DeviceAirPurifier;
