import type { Scenario, ValidationError, ValidationResult } from './types.js';

const ID_REGEX = /^[A-Za-z0-9._-]{1,64}$/;
const AMOUNT_REGEX = /^-?(0|[1-9][0-9]*)$/;
const MAX_AMOUNT_CENTS = 100_000_000n;
const MAX_TITLE_LENGTH = 256;
const MAX_KEY_LENGTH = 256;
const MAX_TABLE_ROWS = 5000;

const ALLOWED_ROOT_KEYS = new Set([
  'schema',
  'specVersion',
  'layout',
  'title',
  'source',
  'base',
  'mid',
  'tail',
]);

const ALLOWED_BASE_KEYS = new Set(['id', 'key', 'amountCents']);
const ALLOWED_MID_KEYS = new Set(['id', 'parentKey', 'linkKey']);
const ALLOWED_TAIL_KEYS = new Set(['id', 'parentKey']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateScenario(raw: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (!isRecord(raw)) {
    return {
      ok: false,
      valid: false,
      errors: [
        {
          path: '',
          code: 'INVALID_TYPE',
          message: 'Scenario must be a non-null object',
        },
      ],
    };
  }

  // Check unknown top-level fields
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      errors.push({
        path: key,
        code: 'UNKNOWN_FIELD',
        message: `Unexpected field "${key}" in scenario root`,
      });
    }
  }

  // Check schema
  if (raw['schema'] !== 'joinwitness.scenario/v1') {
    errors.push({
      path: 'schema',
      code: 'INVALID_SCHEMA',
      message: `Expected schema "joinwitness.scenario/v1", got ${JSON.stringify(raw['schema'])}`,
    });
  }

  // Check specVersion
  if (raw['specVersion'] !== '1.0.0') {
    errors.push({
      path: 'specVersion',
      code: 'INVALID_SPEC_VERSION',
      message: `Expected specVersion "1.0.0", got ${JSON.stringify(raw['specVersion'])}`,
    });
  }

  // Check layout
  const layout = raw['layout'];
  const isValidLayout = layout === 'single' || layout === 'star' || layout === 'chain';
  if (!isValidLayout) {
    errors.push({
      path: 'layout',
      code: 'INVALID_LAYOUT',
      message: `Invalid layout: ${JSON.stringify(layout)}. Must be "single", "star", or "chain"`,
    });
  }

  // Check source
  const source = raw['source'];
  if (source !== 'synthetic' && source !== 'user_imported') {
    errors.push({
      path: 'source',
      code: 'INVALID_SOURCE',
      message: `Invalid source: ${JSON.stringify(source)}. Must be "synthetic" or "user_imported"`,
    });
  }

  // Check title
  const title = raw['title'];
  if (typeof title !== 'string' || title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    errors.push({
      path: 'title',
      code: 'INVALID_TITLE',
      message: `Title must be a non-empty string with length <= ${MAX_TITLE_LENGTH}`,
    });
  }

  // Check base array
  const base = raw['base'];
  if (!Array.isArray(base)) {
    errors.push({
      path: 'base',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: 'base must be an array',
    });
  } else if (base.length < 1 || base.length > MAX_TABLE_ROWS) {
    errors.push({
      path: 'base',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: `base rows count must be between 1 and ${MAX_TABLE_ROWS}, got ${base.length}`,
    });
  } else {
    const seenBaseIds = new Set<string>();
    for (let i = 0; i < base.length; i++) {
      const row = base[i];
      const rowPath = `base[${i}]`;
      if (!isRecord(row)) {
        errors.push({
          path: rowPath,
          code: 'INVALID_ROW_TYPE',
          message: `${rowPath} must be a non-null object`,
        });
        continue;
      }

      for (const k of Object.keys(row)) {
        if (!ALLOWED_BASE_KEYS.has(k)) {
          errors.push({
            path: `${rowPath}.${k}`,
            code: 'UNKNOWN_FIELD',
            message: `Unexpected field "${k}" in base row`,
          });
        }
      }

      const id = row['id'];
      if (typeof id !== 'string' || !ID_REGEX.test(id)) {
        errors.push({
          path: `${rowPath}.id`,
          code: 'INVALID_ID_FORMAT',
          message: `base id must match [A-Za-z0-9._-]{1,64}, got ${JSON.stringify(id)}`,
        });
      } else {
        if (seenBaseIds.has(id)) {
          errors.push({
            path: `${rowPath}.id`,
            code: 'DUPLICATE_ID',
            message: `Duplicate id "${id}" in base table`,
          });
        } else {
          seenBaseIds.add(id);
        }
      }

      const key = row['key'];
      if (!(key === null || (typeof key === 'string' && key.length <= MAX_KEY_LENGTH))) {
        errors.push({
          path: `${rowPath}.key`,
          code: 'INVALID_KEY',
          message: `base key must be a string (<= ${MAX_KEY_LENGTH} chars) or null`,
        });
      }

      const amountCents = row['amountCents'];
      if (typeof amountCents !== 'string' || !AMOUNT_REGEX.test(amountCents) || amountCents === '-0') {
        errors.push({
          path: `${rowPath}.amountCents`,
          code: 'INVALID_AMOUNT',
          message: `amountCents must match ^-?(0|[1-9][0-9]*)$ and cannot be "-0", got ${JSON.stringify(amountCents)}`,
        });
      } else {
        try {
          const val = BigInt(amountCents);
          const absVal = val < 0n ? -val : val;
          if (absVal > MAX_AMOUNT_CENTS) {
            errors.push({
              path: `${rowPath}.amountCents`,
              code: 'AMOUNT_OUT_OF_BOUNDS',
              message: `amountCents absolute value must be <= ${MAX_AMOUNT_CENTS} cents, got ${amountCents}`,
            });
          }
        } catch {
          errors.push({
            path: `${rowPath}.amountCents`,
            code: 'INVALID_AMOUNT',
            message: `Invalid integer format for amountCents: ${amountCents}`,
          });
        }
      }
    }
  }

  // Check mid array
  const mid = raw['mid'];
  if (!Array.isArray(mid)) {
    errors.push({
      path: 'mid',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: 'mid must be an array',
    });
  } else if (mid.length > MAX_TABLE_ROWS) {
    errors.push({
      path: 'mid',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: `mid rows count must be between 0 and ${MAX_TABLE_ROWS}, got ${mid.length}`,
    });
  } else {
    const seenMidIds = new Set<string>();
    for (let i = 0; i < mid.length; i++) {
      const row = mid[i];
      const rowPath = `mid[${i}]`;
      if (!isRecord(row)) {
        errors.push({
          path: rowPath,
          code: 'INVALID_ROW_TYPE',
          message: `${rowPath} must be a non-null object`,
        });
        continue;
      }

      for (const k of Object.keys(row)) {
        if (!ALLOWED_MID_KEYS.has(k)) {
          errors.push({
            path: `${rowPath}.${k}`,
            code: 'UNKNOWN_FIELD',
            message: `Unexpected field "${k}" in mid row`,
          });
        }
      }

      const id = row['id'];
      if (typeof id !== 'string' || !ID_REGEX.test(id)) {
        errors.push({
          path: `${rowPath}.id`,
          code: 'INVALID_ID_FORMAT',
          message: `mid id must match [A-Za-z0-9._-]{1,64}, got ${JSON.stringify(id)}`,
        });
      } else {
        if (seenMidIds.has(id)) {
          errors.push({
            path: `${rowPath}.id`,
            code: 'DUPLICATE_ID',
            message: `Duplicate id "${id}" in mid table`,
          });
        } else {
          seenMidIds.add(id);
        }
      }

      const parentKey = row['parentKey'];
      if (!(parentKey === null || (typeof parentKey === 'string' && parentKey.length <= MAX_KEY_LENGTH))) {
        errors.push({
          path: `${rowPath}.parentKey`,
          code: 'INVALID_KEY',
          message: `mid parentKey must be a string (<= ${MAX_KEY_LENGTH} chars) or null`,
        });
      }

      // Chain layout requires explicit linkKey property (can be string or null)
      if (isValidLayout && layout === 'chain') {
        if (!('linkKey' in row)) {
          errors.push({
            path: `${rowPath}.linkKey`,
            code: 'MISSING_LINK_KEY',
            message: 'Layout "chain" requires mid row to explicitly carry linkKey (can be null)',
          });
        } else {
          const linkKey = row['linkKey'];
          if (!(linkKey === null || (typeof linkKey === 'string' && linkKey.length <= MAX_KEY_LENGTH))) {
            errors.push({
              path: `${rowPath}.linkKey`,
              code: 'INVALID_LINK_KEY',
              message: `linkKey must be a string (<= ${MAX_KEY_LENGTH} chars) or null, got ${JSON.stringify(linkKey)}`,
            });
          }
        }
      } else {
        // Star or single layout: linkKey is optional
        if ('linkKey' in row && row['linkKey'] !== undefined) {
          const linkKey = row['linkKey'];
          if (!(linkKey === null || (typeof linkKey === 'string' && linkKey.length <= MAX_KEY_LENGTH))) {
            errors.push({
              path: `${rowPath}.linkKey`,
              code: 'INVALID_LINK_KEY',
              message: `linkKey must be a string (<= ${MAX_KEY_LENGTH} chars) or null, got ${JSON.stringify(linkKey)}`,
            });
          }
        }
      }
    }
  }

  // Check tail array
  const tail = raw['tail'];
  if (!Array.isArray(tail)) {
    errors.push({
      path: 'tail',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: 'tail must be an array',
    });
  } else if (tail.length > MAX_TABLE_ROWS) {
    errors.push({
      path: 'tail',
      code: 'ROW_COUNT_OUT_OF_BOUNDS',
      message: `tail rows count must be between 0 and ${MAX_TABLE_ROWS}, got ${tail.length}`,
    });
  } else if (isValidLayout && layout === 'single' && tail.length > 0) {
    errors.push({
      path: 'tail',
      code: 'INVALID_LAYOUT_TAIL',
      message: 'Layout "single" requires tail to be empty',
    });
  } else {
    const seenTailIds = new Set<string>();
    for (let i = 0; i < tail.length; i++) {
      const row = tail[i];
      const rowPath = `tail[${i}]`;
      if (!isRecord(row)) {
        errors.push({
          path: rowPath,
          code: 'INVALID_ROW_TYPE',
          message: `${rowPath} must be a non-null object`,
        });
        continue;
      }

      for (const k of Object.keys(row)) {
        if (!ALLOWED_TAIL_KEYS.has(k)) {
          errors.push({
            path: `${rowPath}.${k}`,
            code: 'UNKNOWN_FIELD',
            message: `Unexpected field "${k}" in tail row`,
          });
        }
      }

      const id = row['id'];
      if (typeof id !== 'string' || !ID_REGEX.test(id)) {
        errors.push({
          path: `${rowPath}.id`,
          code: 'INVALID_ID_FORMAT',
          message: `tail id must match [A-Za-z0-9._-]{1,64}, got ${JSON.stringify(id)}`,
        });
      } else {
        if (seenTailIds.has(id)) {
          errors.push({
            path: `${rowPath}.id`,
            code: 'DUPLICATE_ID',
            message: `Duplicate id "${id}" in tail table`,
          });
        } else {
          seenTailIds.add(id);
        }
      }

      const parentKey = row['parentKey'];
      if (!(parentKey === null || (typeof parentKey === 'string' && parentKey.length <= MAX_KEY_LENGTH))) {
        errors.push({
          path: `${rowPath}.parentKey`,
          code: 'INVALID_KEY',
          message: `tail parentKey must be a string (<= ${MAX_KEY_LENGTH} chars) or null`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      valid: false,
      errors,
    };
  }

  const scenario = raw as unknown as Scenario;
  return {
    ok: true,
    valid: true,
    value: scenario,
    scenario,
    errors: [],
  };
}
