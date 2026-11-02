export type Layout = 'single' | 'star' | 'chain';

export interface BaseRow {
  id: string;
  key: string | null;
  amountCents: string;
}

export interface MidRow {
  id: string;
  parentKey: string | null;
  linkKey?: string | null;
}

export interface TailRow {
  id: string;
  parentKey: string | null;
}

export interface Scenario {
  schema: 'joinwitness.scenario/v1';
  specVersion: '1.0.0';
  layout: Layout;
  title: string;
  source: 'synthetic' | 'user_imported';
  base: BaseRow[];
  mid: MidRow[];
  tail: TailRow[];
}

export interface RowAudit {
  id: string;
  factor: string;
  amountCents: string;
  naiveContributionCents: string;
  deltaCents: string;
  branch1Count: number;
  branch2Count: number;
}

export interface AuditWitness {
  rowIds: {
    base: string[];
    mid: string[];
    tail: string[];
  };
  kind: 'NUMERIC_AND_STRUCTURAL' | 'STRUCTURAL_ONLY' | 'NONE';
}

export interface Audit {
  schema: 'joinwitness.audit/v1';
  scenarioSha256: string;
  baseRows: number;
  expandedRows: string;
  expandedRowsPreviewed: number;
  safeSumCents: string;
  naiveSumCents: string;
  deltaCents: string;
  unsafeBaseRows: number;
  rows: RowAudit[];
  witness: AuditWitness;
}

export interface ValidationError {
  path: string;
  code: string;
  message: string;
}

export interface ValidationSuccess {
  ok: true;
  valid: true;
  value: Scenario;
  scenario: Scenario;
  errors: [];
}

export interface ValidationFailure {
  ok: false;
  valid: false;
  value?: undefined;
  scenario?: undefined;
  errors: ValidationError[];
}

export type ValidationResult = ValidationSuccess | ValidationFailure;
