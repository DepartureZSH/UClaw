import { describe, expect, it } from 'vitest';
import {
  computeModelPrice,
  isChatCompatible,
  parsePricingResponse,
  type NewApiPricingItem,
} from '@electron/utils/new-api-pricing';

describe('isChatCompatible', () => {
  it('returns true when supported_endpoint_types is absent', () => {
    expect(isChatCompatible({ model_name: 'gpt-4' })).toBe(true);
  });

  it('returns true when supported_endpoint_types is an empty array', () => {
    expect(isChatCompatible({ model_name: 'gpt-4', supported_endpoint_types: [] })).toBe(true);
  });

  it('returns true when endpoint types include "openai"', () => {
    expect(isChatCompatible({ model_name: 'gpt-4', supported_endpoint_types: ['openai'] })).toBe(true);
  });

  it('returns true when endpoint types include "chat"', () => {
    expect(isChatCompatible({ model_name: 'gpt-4', supported_endpoint_types: ['chat'] })).toBe(true);
  });

  it('returns true when endpoint types include "completions"', () => {
    expect(isChatCompatible({ model_name: 'gpt-4', supported_endpoint_types: ['completions'] })).toBe(true);
  });

  it('returns false when endpoint types are non-chat only', () => {
    expect(isChatCompatible({ model_name: 'dall-e', supported_endpoint_types: ['image'] })).toBe(false);
    expect(isChatCompatible({ model_name: 'embed', supported_endpoint_types: ['embedding'] })).toBe(false);
  });

  it('returns true when endpoint types mix chat and non-chat', () => {
    expect(isChatCompatible({ model_name: 'm', supported_endpoint_types: ['image', 'chat'] })).toBe(true);
  });
});

describe('computeModelPrice', () => {
  // ── Ratio-based branch ──────────────────────────────────────────

  it('uses ratio × groupRatio × base for standard model_ratio items', () => {
    const item: NewApiPricingItem = { model_name: 'deepseek-chat', model_ratio: 0.14, completion_ratio: 4 };
    // deepseek-chat: model_ratio=0.14, completion_ratio=4, base=2, groupRatio=1
    // input  = 0.14 × 1 × 2 = 0.28 USD/M
    // output = 0.14 × 1 × 4 × 2 = 1.12 USD/M
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBeCloseTo(0.28, 6);
    expect(result.output).toBeCloseTo(1.12, 6);
  });

  it('applies groupRatio as a multiplier', () => {
    const item: NewApiPricingItem = { model_name: 'm', model_ratio: 1, completion_ratio: 2 };
    const result = computeModelPrice(item, 0.5, 2);
    expect(result.input).toBeCloseTo(1.0, 6);   // 1 × 0.5 × 2
    expect(result.output).toBeCloseTo(2.0, 6);  // 1 × 0.5 × 2 × 2
  });

  it('defaults completion_ratio to 1 when absent', () => {
    const item: NewApiPricingItem = { model_name: 'm', model_ratio: 1 };
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBeCloseTo(2.0, 6);
    expect(result.output).toBeCloseTo(2.0, 6);
  });

  it('defaults model_ratio to 0 when absent (free model)', () => {
    const item: NewApiPricingItem = { model_name: 'free-model' };
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBe(0);
    expect(result.output).toBe(0);
  });

  // ── model_price=0 bug regression ────────────────────────────────

  it('falls back to ratio-based calculation when model_price is 0 (sentinel value)', () => {
    // This was the bug: model_price=0 is the new-api default for "not configured".
    // It must NOT be used as an actual price; the ratio branch must be taken instead.
    const item: NewApiPricingItem = {
      model_name: 'deepseek-chat',
      model_ratio: 0.14,
      completion_ratio: 4,
      model_price: 0,   // ← sentinel: should be ignored
    };
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBeCloseTo(0.28, 6);   // 0.14 × 1 × 2
    expect(result.output).toBeCloseTo(1.12, 6);  // 0.14 × 1 × 4 × 2
    // Before the fix both would have been 0.
  });

  // ── Direct-price branch ─────────────────────────────────────────

  it('uses model_price directly when it is a positive number', () => {
    const item: NewApiPricingItem = {
      model_name: 'special-model',
      model_price: 3.0,
      completion_ratio: 2,
    };
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBeCloseTo(3.0, 6);
    expect(result.output).toBeCloseTo(6.0, 6);  // 3.0 × 2
  });

  it('uses model_price=1e-6 (very small positive) as direct price, not ratio', () => {
    const item: NewApiPricingItem = { model_name: 'm', model_price: 1e-6, model_ratio: 100 };
    const result = computeModelPrice(item, 1, 2);
    expect(result.input).toBeCloseTo(1e-6, 10);
    // model_ratio=100 would give 200, but model_price wins
  });
});

describe('parsePricingResponse', () => {
  it('filters out non-chat models', () => {
    const response = {
      data: [
        { model_name: 'gpt-4', model_ratio: 1, supported_endpoint_types: ['openai'] },
        { model_name: 'dall-e', model_ratio: 1, supported_endpoint_types: ['image'] },
        { model_name: 'embed', model_ratio: 1, supported_endpoint_types: ['embedding'] },
      ],
    };
    const { models } = parsePricingResponse(response);
    expect(models).toEqual(['gpt-4']);
  });

  it('includes models with no endpoint type declaration', () => {
    const response = {
      data: [{ model_name: 'some-model', model_ratio: 1 }],
    };
    const { models } = parsePricingResponse(response);
    expect(models).toContain('some-model');
  });

  it('applies group_ratio.default as a discount multiplier', () => {
    const response = {
      data: [{ model_name: 'm', model_ratio: 1, completion_ratio: 1 }],
      group_ratio: { default: 0.8, vip: 0.5 },
    };
    const { pricing } = parsePricingResponse(response, 2);
    expect(pricing['m'].input).toBeCloseTo(1.6, 6);   // 1 × 0.8 × 2
    expect(pricing['m'].output).toBeCloseTo(1.6, 6);
  });

  it('defaults group_ratio to 1 when absent', () => {
    const response = {
      data: [{ model_name: 'm', model_ratio: 1 }],
    };
    const { pricing } = parsePricingResponse(response, 2);
    expect(pricing['m'].input).toBeCloseTo(2.0, 6);
  });

  it('uses provided base price override', () => {
    const response = {
      data: [{ model_name: 'm', model_ratio: 1 }],
    };
    const { pricing } = parsePricingResponse(response, 10);
    expect(pricing['m'].input).toBeCloseTo(10.0, 6);
  });

  it('defaults base to 2 when not provided', () => {
    const response = {
      data: [{ model_name: 'm', model_ratio: 1 }],
    };
    const { pricing } = parsePricingResponse(response);
    expect(pricing['m'].input).toBeCloseTo(2.0, 6);
  });

  it('defaults base to 2 when base is 0 or negative', () => {
    const response = { data: [{ model_name: 'm', model_ratio: 1 }] };
    expect(parsePricingResponse(response, 0).pricing['m'].input).toBeCloseTo(2.0, 6);
    expect(parsePricingResponse(response, -5).pricing['m'].input).toBeCloseTo(2.0, 6);
  });

  it('returns empty arrays when data is absent', () => {
    const { models, pricing } = parsePricingResponse({});
    expect(models).toEqual([]);
    expect(pricing).toEqual({});
  });

  // ── model_price=0 regression in full parse flow ──────────────────

  it('computes correct price for deepseek-chat with model_price=0 (real-world regression)', () => {
    // deepseek-chat: model_ratio=0.14, completion_ratio=4, model_price=0 (default/unset)
    // Expected:  input = 0.14 × 1 × 2 = 0.28 USD/M  → ¥0.0020/K at ¥7.3/USD
    //            output = 0.14 × 4 × 2 = 1.12 USD/M → ¥0.0082/K
    const response = {
      data: [{
        model_name: 'deepseek-chat',
        model_ratio: 0.14,
        completion_ratio: 4,
        model_price: 0,
      }],
    };
    const { pricing } = parsePricingResponse(response, 2);
    expect(pricing['deepseek-chat'].input).toBeCloseTo(0.28, 6);
    expect(pricing['deepseek-chat'].output).toBeCloseTo(1.12, 6);
  });
});
