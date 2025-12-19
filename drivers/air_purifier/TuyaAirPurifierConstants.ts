export const AIR_PURIFIER_CAPABILITIES = {
    read_write: [
        'onoff',
        'fan_speed',
        'mode',
        'child_lock',
        'light',
        'switch_led',
        'countdown',
        'countdown_1',
        'filter_reset',
        'bright_value',
        'led_bright'
    ],
    read_only: ['pm25', 'filter', 'temp_current', 'humidity_value'],
} as const;

export const AIR_PURIFIER_CAPABILITIES_MAPPING = {
    onoff: 'onoff',
    switch: 'onoff', // generic switch
    switch_led: 'jafanda_light', // Specific light switch often used in Tuya
    light: 'jafanda_light', // Generic light
    mode: 'fan_mode',
    fan_speed_enum: 'fan_speed',
    child_lock: 'child_lock',
    pm25: 'measure_pm25',
    filter: 'filter_life_percentage',
    temp_current: 'measure_temperature',
    humidity_value: 'measure_humidity',
    // Jafanda Specifics
    countdown: 'jafanda_countdown',
    countdown_1: 'jafanda_countdown',
    get_countdown: 'jafanda_countdown',
    filter_reset: 'jafanda_reset_filter',
    bright_value: 'jafanda_atmosphere', // Atmosphere dimming usually
    led_bright: 'jafanda_display', // Display dimming usually
} as const;
