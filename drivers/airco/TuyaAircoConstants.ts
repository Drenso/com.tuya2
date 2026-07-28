export const AIRCO_CAPABILITIES_MAPPING = {
  switch: 'onoff',
  temp_set: 'target_temperature',
  temp_current: 'measure_temperature',
  humidity_set: 'target_humidity',
  humidity_current: 'measure_humidity',
  lock: 'child_lock',
  child_lock: 'child_lock',
  // `mode` is handled based on the amount of modes
  fan_speed_enum: 'legacy_fan_speed',
  windspeed: 'legacy_fan_speed',
} as const;

export type HomeySocketSettings = {
  temp_set_scaling: '0' | '1' | '2' | '3';
  temp_current_scaling: '0' | '1' | '2' | '3';
  humidity_set_scaling: '0' | '1' | '2' | '3';
  humidity_current_scaling: '0' | '1' | '2' | '3';
};

export const AIRCO_MODE_LABEL_MAPPING = {
  hot: {
    en: 'Heat',
  },
  cold: {
    en: 'Cool',
  },
  wet: {
    en: 'Dry',
  },
  wind: {
    en: 'Fan Only',
  },
} as const;
