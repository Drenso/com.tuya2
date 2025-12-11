import Homey from 'homey';

export function getTuyaClientId(): string {
  return Homey.env.CLIENT_ID;
}
