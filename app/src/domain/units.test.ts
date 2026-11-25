import { formatWeight, parseWeight } from './units';

test('kg/lb input maps to canonical grams and back without drift', () => {
  expect(parseWeight('60', 'kg')).toBe(60000);
  expect(parseWeight('135', 'lb')).toBe(61235);
  expect(formatWeight(parseWeight('135', 'lb'), 'lb')).toBe('135 lb');
  expect(parseWeight('', 'kg')).toBeNull();
  expect(parseWeight('-1', 'kg')).toBeNaN();
  expect(parseWeight('2,5', 'kg')).toBe(2500);
});
