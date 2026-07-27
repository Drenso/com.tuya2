import TuyaDeviceWithCamera from '../../lib/camera/device.js';

export default class TuyaOAuth2DeviceDoorbell extends TuyaDeviceWithCamera {
  protected DOORBELL_TRIGGER_FLOW = 'doorbell_rang';
}
