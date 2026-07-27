import TuyaDeviceWithCamera from '../../lib/camera/device.js';

export default class TuyaOAuth2DeviceCamera extends TuyaDeviceWithCamera {
  DOORBELL_TRIGGER_FLOW = 'camera_doorbell_rang';
}
