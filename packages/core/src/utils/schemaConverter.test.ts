/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  convertSchema,
  ensureObjectRootParameters,
} from './schemaConverter.js';

describe('convertSchema', () => {
  describe('mode: auto (default)', () => {
    it('should preserve type arrays', () => {
      const input = { type: ['string', 'null'] };
      expect(convertSchema(input, 'auto')).toEqual(input);
    });

    it('should preserve items array (tuples)', () => {
      const input = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
      };
      expect(convertSchema(input, 'auto')).toEqual(input);
    });

    it('should preserve mixed enums', () => {
      const input = { enum: [1, 2, '3'] };
      expect(convertSchema(input, 'auto')).toEqual(input);
    });

    it('should preserve unsupported keywords', () => {
      const input = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        exclusiveMinimum: 10,
        type: 'number',
      };
      expect(convertSchema(input, 'auto')).toEqual(input);
    });
  });

  describe('mode: openapi_30 (strict)', () => {
    it('should convert type arrays to nullable', () => {
      const input = { type: ['string', 'null'] };
      const expected = { type: 'string', nullable: true };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should fallback to first type for non-nullable arrays', () => {
      const input = { type: ['string', 'number'] };
      const expected = { type: 'string' };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should convert const to enum', () => {
      const input = { const: 'foo' };
      const expected = { enum: ['foo'] };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should convert exclusiveMinimum number to boolean', () => {
      const input = { type: 'number', exclusiveMinimum: 10 };
      const expected = {
        type: 'number',
        minimum: 10,
        exclusiveMinimum: true,
      };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should convert nested objects recursively', () => {
      const input = {
        type: 'object',
        properties: {
          prop1: { type: ['integer', 'null'], exclusiveMaximum: 5 },
        },
      };
      const expected = {
        type: 'object',
        properties: {
          prop1: {
            type: 'integer',
            nullable: true,
            maximum: 5,
            exclusiveMaximum: true,
          },
        },
      };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should stringify enums', () => {
      const input = { enum: [1, 2, '3'] };
      const expected = { enum: ['1', '2', '3'] };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should remove tuple items (array of schemas)', () => {
      const input = {
        type: 'array',
        items: [{ type: 'string' }, { type: 'number' }],
      };
      const expected = { type: 'array' };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });

    it('should remove unsupported keywords', () => {
      const input = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        $id: '#foo',
        type: 'string',
        default: 'bar',
        dependencies: { foo: ['bar'] },
        patternProperties: { '^foo': { type: 'string' } },
      };
      const expected = { type: 'string' };
      expect(convertSchema(input, 'openapi_30')).toEqual(expected);
    });
  });
});

describe('ensureObjectRootParameters', () => {
  it('returns the schema unchanged when it already declares an object root type', () => {
    const input = {
      type: 'object',
      properties: { foo: { type: 'string' } },
    };
    const result = ensureObjectRootParameters(input);
    expect(result).toBe(input); // same reference, no copy
  });

  it('returns the schema unchanged for any string root type', () => {
    const input = { type: 'string' };
    expect(ensureObjectRootParameters(input)).toBe(input);
  });

  it('prepends type "object" when the root has no type (oneOf root)', () => {
    const input = {
      oneOf: [
        { properties: { a: { type: 'string' } } },
        { properties: { b: { type: 'number' } } },
      ],
    };
    const result = ensureObjectRootParameters(input);
    expect(result).toEqual({ type: 'object', ...input });
    expect(result['type']).toBe('object');
    // Non-mutating: original is untouched.
    expect('type' in input).toBe(false);
  });

  it('prepends type "object" for an anyOf root (zod discriminatedUnion shape)', () => {
    const input = {
      anyOf: [{ required: ['a'] }, { required: ['b'] }],
    };
    expect(ensureObjectRootParameters(input)).toEqual({
      type: 'object',
      ...input,
    });
  });

  it('leaves a non-string type array as-is (spread overrides the prepend)', () => {
    // The guard only fires for a string `type`. For a type array the object
    // spread re-applies the original `type`, so the array is preserved. A
    // type-array root on tool parameters is not a real-world case (params are
    // always an object), so this matches the upstream (Spectre) behavior.
    const input = { type: ['object', 'null'] };
    const result = ensureObjectRootParameters(input);
    expect(result['type']).toEqual(['object', 'null']);
  });
});
