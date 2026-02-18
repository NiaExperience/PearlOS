/**
 * Tests for complex object handling in metadata-utils
 * Focus on array-of-objects editing (like dogs array) using YAML format
 */
import * as yaml from 'js-yaml';

import { valueToEditString, editStringToValue } from '@interface/lib/metadata-utils';

describe('metadata-utils: YAML-based complex object handling', () => {
  describe('valueToEditString', () => {
    test('converts array of complex objects to YAML format', () => {
      const dogsArray = [
        { name: 'Rogue', breed: 'Havanese', age: '6', personality: 'playful and energetic' },
        { name: 'Max', breed: 'Golden Retriever', age: '3', personality: 'friendly and loyal' },
      ];

      const result = valueToEditString(dogsArray);

      // Should be YAML format (not JSON)
      expect(result).toContain('- name:');
      expect(result).toContain('  breed:');
      expect(result).not.toContain('[');
      expect(result).not.toContain('{');
      
      // Should be parseable as YAML
      const parsed = yaml.load(result);
      expect(parsed).toEqual(dogsArray);
    });

    test('converts array of simple strings to newline-separated format', () => {
      const simpleArray = ['apple', 'banana', 'cherry'];

      const result = valueToEditString(simpleArray);

      // Should be newline-separated (backward compatible)
      expect(result).toBe('apple\nbanana\ncherry');
      expect(result).not.toContain('[');
    });

    test('converts array with simple objects (single key) to newline-separated', () => {
      const simpleObjects = [{ id: '1' }, { id: '2' }, { id: '3' }];

      const result = valueToEditString(simpleObjects);

      // Should be newline-separated (backward compatible)
      expect(result).toContain('{"id":"1"}');
      expect(result).toContain('{"id":"2"}');
      expect(result).not.toContain('[\n');
    });

    test('handles mixed array with both simple and complex objects as YAML', () => {
      const mixedArray = [
        { name: 'Rogue', breed: 'Havanese' }, // Complex (2+ keys)
        'some string',
      ];

      const result = valueToEditString(mixedArray);

      // Should be YAML due to complex object
      expect(result).toContain('- name:');
      expect(result).toContain('  breed:');
      
      const parsed = yaml.load(result);
      expect(parsed).toEqual(mixedArray);
    });
  });

  describe('editStringToValue', () => {
    test('parses YAML array of complex objects back to array', () => {
      const dogsArray = [
        { name: 'Rogue', breed: 'Havanese', age: '6', personality: 'playful' },
        { name: 'Max', breed: 'Golden Retriever', age: '3', personality: 'friendly' },
      ];

      const editString = yaml.dump(dogsArray);
      const result = editStringToValue(editString, dogsArray);

      expect(result).toEqual(dogsArray);
    });

    test('parses JSON array for backward compatibility', () => {
      const dogsArray = [
        { name: 'Rogue', breed: 'Havanese', age: '6' },
      ];

      const editString = JSON.stringify(dogsArray, null, 2);
      const result = editStringToValue(editString, dogsArray);

      expect(result).toEqual(dogsArray);
    });

    test('parses newline-separated strings back to array (backward compatibility)', () => {
      const originalArray = ['apple', 'banana', 'cherry'];
      const editString = 'apple\nbanana\ncherry';

      const result = editStringToValue(editString, originalArray);

      expect(result).toEqual(originalArray);
    });

    test('parses newline-separated JSON objects back to array (backward compatibility)', () => {
      const originalArray = [{ id: '1' }, { id: '2' }];
      const editString = '{"id":"1"}\n{"id":"2"}';

      const result = editStringToValue(editString, originalArray);

      expect(result).toEqual(originalArray);
    });

    test('handles edited YAML array with modifications', () => {
      const originalArray = [
        { name: 'Rogue', breed: 'Havanese', age: '6' },
      ];

      // User edits the YAML to add a new dog
      const editedYAML = yaml.dump([
        { name: 'Rogue', breed: 'Havanese', age: '7' }, // Updated age
        { name: 'Buddy', breed: 'Labrador', age: '2' }, // Added new dog
      ]);

      const result = editStringToValue(editedYAML, originalArray);

      expect(result).toHaveLength(2);
      expect(Array.isArray(result) && typeof result[0] === 'object' && result[0] !== null && 'age' in result[0] ? result[0].age : null).toBe('7');
      expect(Array.isArray(result) && typeof result[1] === 'object' && result[1] !== null && 'name' in result[1] ? result[1].name : null).toBe('Buddy');
    });

    test('rejects invalid YAML array format', () => {
      const originalArray = [{ name: 'Rogue' }];
      const invalidYAML = '- name: Rogue\n  breed: "Havanese'; // Missing closing quote

      expect(() => {
        editStringToValue(invalidYAML, originalArray);
      }).toThrow('Invalid YAML array');
    });

    test('rejects non-array YAML when original was array', () => {
      const originalArray = [{ name: 'Rogue' }];
      const objectYAML = 'name: Rogue\nbreed: Havanese'; // Object, not array

      expect(() => {
        editStringToValue(objectYAML, originalArray);
      }).toThrow('Expected an array');
    });
  });

  describe('round-trip: valueToEditString -> edit -> editStringToValue', () => {
    test('dogs array: converts to YAML, allows editing, converts back', () => {
      const dogs = [
        { name: 'Rogue', breed: 'Havanese', age: '6', personality: 'playful' },
        { name: 'Max', breed: 'Golden Retriever', age: '3', personality: 'friendly' },
      ];

      // Convert to edit string (YAML)
      const editString = valueToEditString(dogs);
      expect(editString).toContain('- name:');

      // Simulate user editing (parse, modify, dump)
      const parsed = yaml.load(editString) as Array<Record<string, string>>;
      parsed[0].age = '7'; // User updates Rogue's age
      parsed.push({ name: 'Buddy', breed: 'Beagle', age: '1', personality: 'curious' });
      const modifiedString = yaml.dump(parsed);

      // Convert back
      const result = editStringToValue(modifiedString, dogs);

      expect(result).toHaveLength(3);
      expect(Array.isArray(result) && typeof result[0] === 'object' && result[0] !== null && 'age' in result[0] ? result[0].age : null).toBe('7');
      expect(Array.isArray(result) && typeof result[2] === 'object' && result[2] !== null && 'name' in result[2] ? result[2].name : null).toBe('Buddy');
    });

    test('simple array: maintains backward compatibility', () => {
      const fruits = ['apple', 'banana', 'cherry'];

      // Convert to edit string (newline-separated)
      const editString = valueToEditString(fruits);
      expect(editString).toBe('apple\nbanana\ncherry');

      // User edits (adds orange)
      const modifiedString = 'apple\nbanana\ncherry\norange';

      // Convert back
      const result = editStringToValue(modifiedString, fruits);

      expect(result).toEqual(['apple', 'banana', 'cherry', 'orange']);
    });
  });
});
