import { TuyaStatus } from '../../types/TuyaTypes';
import { AIR_PURIFIER_CAPABILITIES, AIR_PURIFIER_CAPABILITIES_MAPPING } from './TuyaAirPurifierConstants';
import TuyaOAuth2Device from '../../lib/TuyaOAuth2Device';
import { getFromMap } from '../../lib/TuyaOAuth2Util';

export default class TuyaOAuth2DeviceAirPurifier extends TuyaOAuth2Device {
    async onOAuth2Init(): Promise<void> {
        await super.onOAuth2Init();

        // Register capability listeners
        for (const [tuyaCapability, homeyCapability] of Object.entries(AIR_PURIFIER_CAPABILITIES_MAPPING)) {
            if (this.hasCapability(homeyCapability)) {
                // We only register listeners for settable capabilities that we have mapped
                if ((AIR_PURIFIER_CAPABILITIES.read_write as readonly string[]).includes(tuyaCapability)) {
                    if (this.hasTuyaCapability(tuyaCapability)) {
                        this.registerCapabilityListener(homeyCapability, value => this.sendCommand({ code: tuyaCapability, value }));
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

            if (homeyCapability) {
                await this.safeSetCapabilityValue(homeyCapability, value);
            }
        }
    }
}

module.exports = TuyaOAuth2DeviceAirPurifier;
