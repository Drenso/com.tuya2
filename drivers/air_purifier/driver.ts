import { DEVICE_CATEGORIES } from '../../lib/TuyaOAuth2Constants';
import TuyaOAuth2Driver, { ListDeviceProperties } from '../../lib/TuyaOAuth2Driver';
import { constIncludes, getFromMap } from '../../lib/TuyaOAuth2Util';
import {
    type TuyaDeviceDataPointResponse,
    TuyaDeviceResponse,
    TuyaDeviceSpecificationResponse,
} from '../../types/TuyaApiTypes';
import { AIR_PURIFIER_CAPABILITIES, AIR_PURIFIER_CAPABILITIES_MAPPING } from './TuyaAirPurifierConstants';

export default class TuyaOAuth2DriverAirPurifier extends TuyaOAuth2Driver {

    TUYA_DEVICE_CATEGORIES = [DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES.AIR_PURIFIER] as const;

    // Explicitly support Jafanda PIDs and generic air purifiers
    JAFANDA_PRODUCT_IDS = [
        'vpb3fd5rhtgd7b4t', // JF260S
        'az2mhfjoivlaqays', // JF500
    ];

    onTuyaPairListDeviceFilter(device: TuyaDeviceResponse): boolean {
        // 1. Allow if PID matches known Jafanda devices
        if (this.JAFANDA_PRODUCT_IDS.includes(device.product_id)) {
            return true;
        }

        // 2. Fallback: Allow if category matches generic air purifier
        if ((Object.values(DEVICE_CATEGORIES.SMALL_HOME_APPLIANCES) as string[]).includes(device.category)) {
            return true;
        }

        return false;
    }

    onTuyaPairListDeviceProperties(
        device: TuyaDeviceResponse,
        specifications?: TuyaDeviceSpecificationResponse,
        dataPoints?: TuyaDeviceDataPointResponse,
    ): ListDeviceProperties {
        const props = super.onTuyaPairListDeviceProperties(device, specifications, dataPoints);

        for (const status of device.status) {
            const tuyaCapability = status.code;
            const homeyCapability = getFromMap(AIR_PURIFIER_CAPABILITIES_MAPPING, tuyaCapability);

            if (constIncludes(AIR_PURIFIER_CAPABILITIES.read_write, tuyaCapability) && homeyCapability) {
                props.store.tuya_capabilities.push(tuyaCapability);
                props.capabilities.push(homeyCapability);
            }

            // We don't have specific 'setting' capabilities for air purifiers yet, but following the pattern:
            if (constIncludes(AIR_PURIFIER_CAPABILITIES.read_only, tuyaCapability) && homeyCapability) {
                props.capabilities.push(homeyCapability);
            }
        }

        return props;
    }
}

module.exports = TuyaOAuth2DriverAirPurifier;
