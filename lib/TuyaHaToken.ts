import { OAuth2Token } from 'homey-oauth2app';

export default class TuyaHaToken extends OAuth2Token {
  public endpoint: string;
  public uid: string;
  public expire_time: number;
  public terminal_id: string;
  public username: string;

  public constructor({
    endpoint,
    uid,
    expire_time,
    terminal_id,
    username,
    ...props
  }: {
    endpoint: string;
    uid: string;
    expire_time: number;
    access_token: string;
    refresh_token: string;
    terminal_id: string;
    username: string;
  }) {
    super({ ...props });

    this.endpoint = endpoint;
    this.uid = uid;
    this.expire_time = expire_time;
    this.terminal_id = terminal_id;
    this.username = username;
  }

  public toJSON(): {
    access_token: string;
    refresh_token: string;
    uid: string;
    expire_time: number;
    endpoint: string;
    terminal_id: string;
    username: string;
  } {
    return {
      ...super.toJSON(),
      endpoint: this.endpoint,
      uid: this.uid,
      expire_time: this.expire_time,
      terminal_id: this.terminal_id,
      username: this.username,
    };
  }
}
