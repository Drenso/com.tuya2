import { SPA_ERROR_CODES } from './TuyaSpaConstants';

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/**
 * Map a single Tuya `error_code` bitmap label to a human-readable description
 * in the given language, falling back to a generic "Error E<n>" string for
 * labels that have no known meaning.
 */
export function describeSpaError(label: string, language = 'en'): string {
  const entry = SPA_ERROR_CODES[label];
  if (!entry) {
    // Tuya labels in the 1xx range correspond to Intex E-codes (label - 100).
    const numeric = parseInt(label, 10);
    const eCode = !Number.isNaN(numeric) && numeric >= 100 ? `E${numeric - 100}` : label;
    return language === 'nl' ? `Onbekende fout (${eCode})` : `Unknown error (${eCode})`;
  }
  return language === 'nl' ? entry.nl : entry.en;
}
