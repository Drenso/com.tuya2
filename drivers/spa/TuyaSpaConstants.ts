/**
 * Tuya "Smart Spa" (category `rs`) data point mapping.
 *
 * These spas (e.g. Intex PureSpa, product_id m7qtzuouc2cvnekt) use the raw DP
 * instruction set rather than the standard heater instructions, so the DP codes
 * differ from the regular heater driver:
 *
 *   power_switch    Boolean   main power on/off
 *   heater_switch   Boolean   heater on/off
 *   bubble_switch   Boolean   bubbles on/off
 *   filter_switch   Boolean   filter pump on/off
 *   tempture_set    Integer   target water temperature (°F, 50-104)
 *   water_tempture  Integer   current water temperature (°F)
 *   heat_indicator  Enum      off / heat / warm / warmflash
 *   error_code      Bitmap    fault codes
 */

// Single-value capabilities (one Tuya code -> one Homey capability).
export const SPA_CAPABILITIES_MAPPING = {
  power_switch: 'onoff',
  tempture_set: 'target_temperature',
  water_tempture: 'measure_temperature',
} as const;

// Boolean sub-switches that become onoff.<sub> capabilities.
export const SPA_SUB_SWITCHES = {
  heater_switch: 'onoff.heater',
  bubble_switch: 'onoff.bubble',
  filter_switch: 'onoff.filter',
} as const;

export type HomeySpaSettings = {
  temp_set_scaling: '0' | '1' | '2' | '3';
};

export type TuyaSpaSettings = Record<string, never>;
