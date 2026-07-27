/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'homey-oauth2app' {
  import Homey, { SimpleClass } from 'homey';
  import type { Log } from 'homey-log';
  import type PairSession from 'homey/lib/PairSession';
  export { fetch } from 'node-fetch';

  export class OAuth2App extends Homey.App {
    public onOAuth2Init(): Promise<void>;

    public getFirstSavedOAuth2Client(): OAuth2Client;

    public getSavedOAuth2Sessions(): Record<string, unknown>;

    public homeyLog: Log;
  }

  export class OAuth2Client<TToken extends OAuth2Token> extends SimpleClass {
    protected static API_URL: string;
    protected static TOKEN_URL: string;
    protected static AUTHORIZATION_URL: string;
    protected static SCOPES: string[];

    public _token?: TToken;
    public _clientId!: string;
    public _clientSecret!: string;
    public _refreshingToken: Promise<void> | null;

    public homey: Homey;

    public get<T>(data: { path: string; query?: any; headers?: any }): Promise<T>;

    public delete<T>(data: { path: string; query?: any; headers?: any }): Promise<T>;

    public post<T>(data: { path: string; query?: any; json?: any; body?: any; headers?: any }): Promise<T>;

    public put<T>(data: { path: string; query?: any; json?: any; body?: any; headers?: any }): Promise<T>;

    public onShouldRefreshToken(args: { status: number }): Promise<boolean>;

    public getToken(): TToken | null;

    public setToken({ token: TToken }): void;

    public getTitle(): string;

    public setTitle({ title: string }): void;

    public async refreshToken(...args): Promise<void>;

    public save(): void;

    public destroy(): void;

    public async onBuildRequest(args: {
      method: string;
      path: string;
      json: object;
      body: object;
      query: object;
      headers: object;
    }): Promise<{
      opts: {
        method: unknown;
        body: unknown;
        headers: object;
      };
      url: string;
    }>;
  }

  export class OAuth2Device<T extends OAuth2Client> extends Homey.Device {
    public oAuth2Client: T;

    public onOAuth2Init(): Promise<void>;

    public onOAuth2Uninit(): Promise<void>;

    public onOAuth2Saved(): Promise<void>;

    public onOAuth2Added(): Promise<void>;

    public onOAuth2Deleted(): Promise<void>;

    public homey: Homey;

    public ready(): Promise<void>;

    public setCameraVideo(id: string, title: string, video: unknown): Promise<void>;
  }

  export class OAuth2Driver<T extends OAuth2Client> extends Homey.Driver {
    public onOAuth2Init(): Promise<void>;

    public onPairListDevices(payload: { oAuth2Client: T }): Promise<OAuth2DeviceResult[]>;

    public getOAuth2ConfigId(): string;

    public homey: Homey;

    public onPair(session: PairSession, device?: OAuth2Device<T>): Promise<void>;
    public onRepair(session: PairSession, device?: OAuth2Device<T>): Promise<void>;

    public ready(): Promise<void>;
  }

  export interface OAuth2DeviceResult {
    name: string;
    data: {
      [key: string]: any;
    };
    store?: {
      [key: string]: any;
    };
    settings?: {
      [key: string]: any;
    };
    icon?: string;
    capabilities?: string[];
    capabilitiesOptions?: {
      [key: string]: {
        [key: string]: any;
      };
    };
    class?: string;
  }

  export class OAuth2Token {
    public access_token: string;
    public refresh_token: string;
    public token_type?: string;
    public expires_in?: number;

    public constructor(param: {
      access_token: string;
      refresh_token: string;
      token_type?: string;
      expires_in?: number;
    });

    public isRefreshable(): boolean;

    public toJSON(): {
      access_token: string;
      refresh_token: string;
      token_type?: string;
      expires_in?: number;
    };
  }

  export class OAuth2Error {
    public constructor(message: string, statusCode?: number);
  }

  export class OAuth2Util {
    public static getRandomId(): string;
  }
}
