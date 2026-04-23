/**
 * Pricing utilities for new-api compatible endpoints.
 *
 * new-api's /api/pricing endpoint returns per-model pricing in one of two formats:
 *   A) model_price > 0  — the fork returns the actual USD/M token price directly.
 *   B) model_price == 0 or absent — standard new-api: price is derived from
 *      model_ratio × group_ratio × BASE, where BASE defaults to 2 USD/M when
 *      model_ratio = 1.
 *
 * IMPORTANT: model_price = 0 is the new-api default for "not configured" and must
 * NOT be treated as a real price of zero.  Always fall back to the ratio-based
 * calculation when model_price is 0 or absent.
 */

export interface ModelPricingEntry {
  /** USD per million input tokens */
  input: number;
  /** USD per million output tokens */
  output: number;
}

export interface NewApiPricingItem {
  model_name: string;
  supported_endpoint_types?: string[];
  /** Relative price multiplier (ratio vs BASE price). Used when model_price is absent/0. */
  model_ratio?: number;
  /** Output-to-input price ratio. Defaults to 1 if absent. */
  completion_ratio?: number;
  /**
   * Direct USD/M price. Only meaningful when > 0.
   * A value of 0 means "not configured" — fall back to model_ratio calculation.
   */
  model_price?: number;
}

export interface NewApiPricingResponse {
  data?: NewApiPricingItem[];
  /** Per-user-group price multiplier map. Key "default" is the anonymous group. */
  group_ratio?: Record<string, number>;
}

const CHAT_ENDPOINT_TYPES = new Set(['openai', 'chat', 'completions']);

/**
 * Returns true if the item should be treated as a chat-compatible model.
 * Items with no endpoint type declaration are assumed chat-compatible.
 */
export function isChatCompatible(item: NewApiPricingItem): boolean {
  const types = item.supported_endpoint_types;
  if (!Array.isArray(types) || types.length === 0) return true;
  return types.some((t) => CHAT_ENDPOINT_TYPES.has(t));
}

/**
 * Compute USD/M token prices for a single model entry.
 *
 * @param item       - Pricing item from /api/pricing response
 * @param groupRatio - Group discount multiplier (default: 1)
 * @param base       - Base price in USD/M when model_ratio=1 (default: 2)
 */
export function computeModelPrice(
  item: NewApiPricingItem,
  groupRatio = 1,
  base = 2,
): ModelPricingEntry {
  const cr = item.completion_ratio ?? 1;

  // Only use the direct-price branch when model_price is explicitly a positive number.
  // model_price=0 is the new-api sentinel for "price not configured" — fall back to ratios.
  if (typeof item.model_price === 'number' && item.model_price > 0) {
    return {
      input: item.model_price,
      output: item.model_price * cr,
    };
  }

  // Standard new-api ratio-based calculation
  const r = item.model_ratio ?? 0;
  return {
    input: r * groupRatio * base,
    output: r * groupRatio * cr * base,
  };
}

/**
 * Parse a full /api/pricing JSON response into a model→price map.
 * Non-chat models are filtered out.
 *
 * @param pricingJson - Raw /api/pricing response body
 * @param base        - Optional override for the USD/M base price (default: 2)
 */
export function parsePricingResponse(
  pricingJson: NewApiPricingResponse,
  base?: number,
): { models: string[]; pricing: Record<string, ModelPricingEntry> } {
  const effectiveBase = typeof base === 'number' && base > 0 ? base : 2;
  const groupRatio = pricingJson.group_ratio?.['default'] ?? 1;
  const models: string[] = [];
  const pricing: Record<string, ModelPricingEntry> = {};

  for (const item of pricingJson.data ?? []) {
    if (!isChatCompatible(item)) continue;
    models.push(item.model_name);
    pricing[item.model_name] = computeModelPrice(item, groupRatio, effectiveBase);
  }

  return { models, pricing };
}
