import TuyaOAuth2Driver from '../../lib/TuyaOAuth2Driver';
import { TuyaDeviceResponse } from '../../types/TuyaApiTypes';

export default class TuyaOAuth2DriverAirPurifier extends TuyaOAuth2Driver {

    // Explicitly support Jafanda PIDs and generic air purifiers
    JAFANDA_PRODUCT_IDS = [
        'vpb3fd5rhtgd7b4t', // JF260S
        'az2mhfjoivlaqays', // JF500
    ];

    /* 
     * Note: We do NOT implement onInit() because the base class TuyaOAuth2Driver implementation 
     * is sufficient and we don't have special initialization needs that caused TS errors before.
     */

    onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
        // 1. Allow if PID matches known Jafanda devices
        if (this.JAFANDA_PRODUCT_IDS.includes(device.product_id)) {
            return true;
        }

        // 2. Fallback: Allow if category matches generic air purifier
        if (['kj'].includes(device.category)) {
            // kj = air purifier
            return true;
        }

        return false;
    }
}

module.exports = TuyaOAuth2DriverAirPurifier;
