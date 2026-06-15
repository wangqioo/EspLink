const {
  normalizeVersion,
  compareVersions,
  classifyUpdatePath,
} = require('../services/firmwareVersionPolicy');

describe('firmwareVersionPolicy', () => {
  test('normalizes stable semantic versions and strips a leading v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('  01.002.0003  ')).toBe('1.2.3');
  });

  test('returns null for blank or malformed versions', () => {
    expect(normalizeVersion('')).toBeNull();
    expect(normalizeVersion(null)).toBeNull();
    expect(normalizeVersion('1.2')).toBeNull();
    expect(normalizeVersion('latest')).toBeNull();
  });

  test('compares normalized semantic versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.9.0', '2.0.0')).toBe(-1);
    expect(compareVersions('v2.0.0', '1.9.9')).toBe(1);
  });

  test('throws when comparing malformed versions', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow('invalid firmware version');
  });

  test('classifies update path between current and target versions', () => {
    expect(classifyUpdatePath('1.2.3', '1.2.4')).toBe('upgrade');
    expect(classifyUpdatePath('1.2.3', '1.2.3')).toBe('same');
    expect(classifyUpdatePath('2.0.0', '1.9.9')).toBe('downgrade');
    expect(classifyUpdatePath('bad', '1.0.0')).toBe('unknown');
  });
});
