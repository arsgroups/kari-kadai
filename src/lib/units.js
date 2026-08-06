export const UNIT_OPTIONS = ['Unit', 'Kg', 'Gram']

// Kg and Gram convert 1:1000; 'Unit' is a discrete count and doesn't convert
// to/from a weight unit, so any Unit<->weight pairing falls back to 1 (it's
// not a meaningful combination to begin with — the UI is expected to keep
// weight-tracked items using Kg/Gram consistently).
export function conversionFactor(fromUnit, toUnit) {
  if (fromUnit === toUnit) return 1
  if (fromUnit === 'Kg' && toUnit === 'Gram') return 1000
  if (fromUnit === 'Gram' && toUnit === 'Kg') return 0.001
  return 1
}
