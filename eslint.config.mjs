import drensoConfig from '@drenso/eslint-config-homey-mts';

export default [
  {
    // Temporarily ignore
    ignores: [
      'types/homey-zigbeedriver/index.d.ts',
      'types/homey-zwavedriver/index.d.ts',
      'types/zigbee-clusters/index.d.ts',
    ],
  },
  ...drensoConfig,
];
