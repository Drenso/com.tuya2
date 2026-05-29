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

// Human-readable meanings for the `error_code` bitmap labels.
//
// These spas report Tuya labels in the 1xx/2xx range that correspond to the
// Intex PureSpa "E" fault codes (label minus 100, e.g. label `190` -> E90).
// The descriptions are based on the published Intex PureSpa troubleshooting
// guides. Unknown labels fall back to a generic "Error E<n>" string.
export const SPA_ERROR_CODES: Record<string, { en: string; nl: string }> = {
  '180': {
    en: 'System error (E80)',
    nl: 'Systeemfout (E80)',
  },
  '181': {
    en: 'Communication error between control panel and spa unit (E81)',
    nl: 'Communicatiefout tussen bedieningspaneel en spa-unit (E81)',
  },
  '190': {
    en: 'No or insufficient water flow (E90)',
    nl: 'Geen of onvoldoende waterdoorstroming (E90)',
  },
  '191': {
    en: 'Salt system: too little salt or a scaled/faulty cell (E91)',
    nl: 'Zoutsysteem: te weinig zout of een verkalkte/defecte cel (E91)',
  },
  '192': {
    en: 'Salt concentration too high (E92)',
    nl: 'Zoutconcentratie te hoog (E92)',
  },
  '193': {
    en: 'Sensor or system error (E93)',
    nl: 'Sensor- of systeemfout (E93)',
  },
  '194': {
    en: 'Water temperature too low (E94)',
    nl: 'Watertemperatuur te laag (E94)',
  },
  '195': {
    en: 'Water temperature too high (E95)',
    nl: 'Watertemperatuur te hoog (E95)',
  },
  '196': {
    en: 'System error: internal control fault (E96)',
    nl: 'Systeemfout: interne besturingsfout (E96)',
  },
  '197': {
    en: 'Heater fuse error / dry-fire protection (E97)',
    nl: 'Verwarmingszekeringfout / droogkookbeveiliging (E97)',
  },
  '199': {
    en: 'Water temperature sensor malfunction (E99)',
    nl: 'Storing van de watertemperatuursensor (E99)',
  },
  '200': {
    en: 'Water or ambient temperature too high (E100)',
    nl: 'Water- of omgevingstemperatuur te hoog (E100)',
  },
};

export type HomeySpaSettings = {
  temp_set_scaling: '0' | '1' | '2' | '3';
};

export type TuyaSpaSettings = Record<string, never>;
