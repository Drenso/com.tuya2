import Homey from 'homey';
import sourceMapSupport from 'source-map-support';
sourceMapSupport.install();

import { Log } from '@drenso/homey-log';
import { OAuth2App } from 'homey-oauth2app';
import NodeCache from 'node-cache';
import * as TuyaOAuth2Util from './lib/TuyaOAuth2Util.js';
import type TuyaOAuth2Device from './lib/TuyaOAuth2Device.js';
import type { TuyaDeviceDataPoint, TuyaDeviceSpecificationResponse, TuyaStatusResponse } from './types/TuyaApiTypes.js';
import TuyaHaClient from './lib/TuyaHaClient.js';

const STATUS_CACHE_KEY = 'status';
const DATAPOINT_CACHE_KEY = 'datapoint';
const SPECIFICATION_CACHE_KEY = 'specification';
const SCENE_CACHE_KEY = 'scenes';
const CACHE_TTL = 30;

type DeviceArgs = { device: TuyaOAuth2Device };
type StatusCodeArgs = { code: AutoCompleteArg };
type StatusCodeState = { code: string };
type HomeyTuyaScene = { name: string; id: string; ownerId: string };

type AutoCompleteArg = {
  name: string;
  id: string;
  title: string;
  dataPoint: boolean;
};

export default class TuyaOAuth2App extends OAuth2App {
  protected static OAUTH2_CLIENT = TuyaHaClient;
  protected static OAUTH2_DEBUG = Homey.env.DEBUG === '1';
  protected static OAUTH2_MULTI_SESSION = false; // TODO: Enable this feature & make nice pairing UI

  private apiCache: NodeCache = new NodeCache({ stdTTL: CACHE_TTL });

  public homeyLog = new Log({ homey: this.homey });

  public async onOAuth2Init(): Promise<void> {
    await super.onOAuth2Init();

    const sendCommandRunListener = async ({
      device,
      code,
      value,
    }: {
      device: TuyaOAuth2Device;
      code: AutoCompleteArg;
      value: unknown;
    }): Promise<void> => {
      if (code.dataPoint) {
        await device.setDataPoint(code.id, value);
      } else {
        await device.sendCommand({ code: code.id, value });
      }
    };

    const autocompleteListener = async (
      query: string | undefined,
      args: DeviceArgs,
      filter: ({ value }: { value: unknown }) => boolean,
      commandTypes?: string[],
    ): Promise<Homey.FlowCard.ArgumentAutocompleteResults> => {
      function convert(
        values: TuyaStatusResponse | Array<TuyaDeviceDataPoint>,
        dataPoints: boolean,
      ): AutoCompleteArg[] {
        return values.filter(filter).map(value => ({
          name: value.code,
          id: value.code,
          title: value.code,
          dataPoint: dataPoints,
        }));
      }

      const deviceId = args.device.getData().deviceId;
      let retrievalFailed = false;
      const readCached = async <T>(key: string, read: () => Promise<T>): Promise<T | undefined> => {
        if (this.apiCache.has(key)) return this.apiCache.get<T>(key);
        try {
          const result = await read();
          this.apiCache.set(key, result);
          return result;
        } catch (error) {
          this.error(error);
          retrievalFailed = true;
          // A failed request must be retried, not cached as an empty response.
          return undefined;
        }
      };

      const status = await readCached(`${STATUS_CACHE_KEY}_${deviceId}`, () => args.device.getStatus());
      const dataPoints = await readCached(`${DATAPOINT_CACHE_KEY}_${deviceId}`, () => args.device.queryDataPoints());
      const combinedMap = new Map<string, AutoCompleteArg>();

      // Preserve the existing preference for standard status codes over data points.
      for (const option of dataPoints ? convert(dataPoints.properties, true) : []) {
        combinedMap.set(option.id, option);
      }
      for (const option of status ? convert(status, false) : []) {
        combinedMap.set(option.id, option);
      }

      // Sending cards can also use commands that have no current status value.
      // Never offer write-only functions as receiving/trigger codes.
      if (commandTypes) {
        const specification = await readCached<TuyaDeviceSpecificationResponse>(
          `${SPECIFICATION_CACHE_KEY}_${deviceId}`,
          () => args.device.getSpecification(),
        );
        for (const { code, type } of specification?.functions ?? []) {
          if (!commandTypes.includes(type.toLowerCase())) continue;
          combinedMap.set(code, { id: code, name: code, title: code, dataPoint: false });
        }
      }

      const possibleValues = [...combinedMap.values()];
      if (possibleValues.length === 0) {
        throw new Error(this.homey.__(retrievalFailed ? 'error_retrieving_code_sources' : 'error_retrieving_codes'));
      }

      // An unmatched search is not an API error or an empty device specification.
      const trimmedQuery = (query ?? '').trim().toLowerCase();
      return possibleValues.filter(({ id }) => id.toLowerCase().includes(trimmedQuery));
    };

    // Register Tuya Web API Flow Cards
    // Sending
    this.homey.flow
      .getActionCard('send_command_string')
      .registerRunListener(sendCommandRunListener)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(
          query,
          args,
          ({ value }) => typeof value === 'string' && !TuyaOAuth2Util.hasJsonStructure(value),
          ['string', 'enum'],
        ),
      );

    this.homey.flow
      .getActionCard('send_command_number')
      .registerRunListener(sendCommandRunListener)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(query, args, ({ value }) => typeof value === 'number', ['integer']),
      );

    this.homey.flow
      .getActionCard('send_command_boolean')
      .registerRunListener(sendCommandRunListener)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(query, args, ({ value }) => typeof value === 'boolean', ['boolean']),
      );

    this.homey.flow
      .getActionCard('send_command_json')
      .registerRunListener(
        async ({ device, code, value }: { device: TuyaOAuth2Device; code: string | { id: string }; value: string }) => {
          if (typeof code === 'object') code = code.id;

          await device.sendCommand({
            code,
            value: JSON.parse(value),
          });
        },
      )
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(
          query,
          args,
          ({ value }) => typeof value === 'object' || TuyaOAuth2Util.hasJsonStructure(value),
          ['json'],
        ),
      );

    // Receiving
    this.homey.flow
      .getDeviceTriggerCard('receive_status_boolean')
      .registerRunListener((args: StatusCodeArgs, state: StatusCodeState) => args.code.id === state.code)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(query, args, ({ value }) => typeof value === 'boolean'),
      );

    this.homey.flow
      .getDeviceTriggerCard('receive_status_json')
      .registerRunListener((args: StatusCodeArgs, state: StatusCodeState) => args.code.id === state.code)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(
          query,
          args,
          ({ value }) => typeof value === 'object' || TuyaOAuth2Util.hasJsonStructure(value),
        ),
      );

    this.homey.flow
      .getDeviceTriggerCard('receive_status_number')
      .registerRunListener((args: StatusCodeArgs, state: StatusCodeState) => args.code.id === state.code)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(query, args, ({ value }) => typeof value === 'number'),
      );

    this.homey.flow
      .getDeviceTriggerCard('receive_status_string')
      .registerRunListener((args: StatusCodeArgs, state: StatusCodeState) => args.code.id === state.code)
      .registerArgumentAutocompleteListener('code', async (query: string, args: DeviceArgs) =>
        autocompleteListener(
          query,
          args,
          ({ value }) => typeof value === 'string' && !TuyaOAuth2Util.hasJsonStructure(value),
        ),
      );

    // Tuya scenes
    this.homey.flow
      .getActionCard('trigger_scene')
      .registerRunListener(async (args: { scene: HomeyTuyaScene }) => {
        const { scene } = args;
        const client = this.getFirstSavedOAuth2Client();
        await client.triggerHasScene(scene.ownerId, scene.id);
      })
      .registerArgumentAutocompleteListener('scene', async (query?: string) => {
        if (!this.apiCache.has(SCENE_CACHE_KEY)) {
          this.log('Retrieving available scenes');
          const client = this.getFirstSavedOAuth2Client();

          // Gets all homes for this user
          const homes = await client.getHasHomes().catch(err => {
            this.error(err);
            throw new Error(this.homey.__('error_retrieving_scenes'));
          });

          // Get all scenes for this user's homes
          const scenes: Array<HomeyTuyaScene> = [];
          for (const home of homes) {
            await client
              .getHasScenes(home.ownerId)
              .then(homeScenes =>
                scenes.push(
                  ...homeScenes.map(scene => ({
                    name: scene.name,
                    id: scene.scene_id,
                    ownerId: home.ownerId,
                  })),
                ),
              )
              .catch(err => {
                if (err.tuyaCode === 40001900) {
                  // Access to particular home denied, skip it
                  this.log('Scene home denied access', home.ownerId);
                  return;
                }

                this.error(err);
                throw new Error(this.homey.__('error_retrieving_scenes'));
              });
          }

          this.apiCache.set(SCENE_CACHE_KEY, scenes);
        }

        const scenes = this.apiCache.get<HomeyTuyaScene[]>(SCENE_CACHE_KEY) ?? [];

        const trimmedQuery = (query ?? '').trim();
        if (!trimmedQuery) {
          return scenes;
        }

        return scenes.filter(scene => scene.name.toLowerCase().includes(trimmedQuery.toLowerCase()));
      });

    // Sensor alarm
    this.homey.flow
      .getActionCard('alarm_switch_on')
      .registerRunListener((args: DeviceArgs) => args.device.triggerCapabilityListener('onoff.alarm_switch', true));
    this.homey.flow
      .getActionCard('alarm_switch_off')
      .registerRunListener((args: DeviceArgs) => args.device.triggerCapabilityListener('onoff.alarm_switch', false));

    this.log('Tuya started');
  }

  public getFirstSavedOAuth2Client(): TuyaHaClient {
    const client = super.getFirstSavedOAuth2Client();
    if (!client) {
      throw new Error(this.homey.__('connection_failed'));
    }

    return client as TuyaHaClient;
  }
}
