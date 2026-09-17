import { z } from 'zod';

const text = z.string().min(1).max(500);
export const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);
const source = z.strictObject({ url: z.url().refine(v => v.startsWith('https://')), locator: text.nullable(), kind: z.enum(['primary_paper','official_website','authorized_export']) });
const common = {
  sources: z.array(source).min(1).max(10),
  limitations: z.array(text).min(1).max(20),
  cell_count: z.number().int().nonnegative().nullable(),
  donor_count: z.number().int().nonnegative().nullable(),
};
export const recordSchemas = {
  dataset: z.strictObject({ id, name: text, collection: text.nullable(), regions: z.array(text).max(300), diseases: z.array(text).max(100), sample_type: text.nullable(), age_min_years: z.number().nonnegative().nullable(), age_max_years: z.number().nonnegative().nullable(), download_url: z.url().nullable(), usage_terms: text.nullable(), ...common }).refine(d => d.age_min_years === null || d.age_max_years === null || d.age_min_years <= d.age_max_years),
  region: z.strictObject({ id, name: text, naming_system: text, parent_id: id.nullable(), composition_scope: z.enum(['region_resolved','scope_level_only','not_provided']), cell_types: z.array(z.strictObject({ name: text, cells: z.number().int().nonnegative() })).max(100), ...common }).refine(r => r.composition_scope === 'region_resolved' || r.cell_types.length === 0, 'Scope-level marginals must not be presented as region cell composition'),
  expression: z.strictObject({ id, gene: z.string().regex(/^[A-Za-z0-9.-]{1,40}$/), region: text, cell_type: text.nullable(), scope: z.literal('global_cross_study'), weighting: z.enum(['cell_weighted','donor_balanced']), expression_scale: text.nullable(), mean: z.number().finite().nullable(), detection_fraction: z.number().min(0).max(1).nullable(), ...common }),
  evidence: z.strictObject({ id, title: text, topics: z.array(text).max(30), author_claim: z.string().min(1).max(2500), validation_evidence: z.string().max(2500).nullable(), inference: z.string().max(1000).nullable(), publication_status: z.enum(['preprint','peer_reviewed','not_provided']), ...common }),
  export: z.strictObject({ id, filename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(csv|json|parquet|txt)$/), object_key: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_/.-]{0,240}$/).refine(k => !k.includes('..')), sha256: z.string().regex(/^[a-f0-9]{64}$/), storage_md5: z.string().regex(/^[a-f0-9]{32}$/).optional(), bytes: z.number().int().nonnegative().max(100_000_000), media_type: z.enum(['text/csv','application/json','application/vnd.apache.parquet','text/plain']), ...common }),
};
export const releaseSchema = z.strictObject({
  id, retrieved_at: z.iso.datetime(), data_version: text,
  authorization_reference: text,
  authorization_scope: z.enum(['internal_pilot','external_research']),
  sources: z.array(source).min(1).max(10), limitations: z.array(text).min(1).max(20),
});
export const bundleSchema = z.strictObject({
  release: releaseSchema,
  datasets: z.array(recordSchemas.dataset).max(10000),
  regions: z.array(recordSchemas.region).max(1000),
  expressions: z.array(recordSchemas.expression).max(200000),
  evidence: z.array(recordSchemas.evidence).max(10000),
  exports: z.array(recordSchemas.export).max(1000),
});
const query = z.string().trim().min(1).max(100);
const page = { limit: z.number().int().min(1).max(25).default(10), offset: z.number().int().min(0).max(10000).default(0) };
export const toolSchemas = {
  search_datasets: z.strictObject({ query: query.optional(), region: query.optional(), disease: query.optional(), sample_type: query.optional(), age_min_years: z.number().min(0).max(130).optional(), age_max_years: z.number().min(0).max(130).optional(), ...page }).refine(a => a.age_min_years === undefined || a.age_max_years === undefined || a.age_min_years <= a.age_max_years, 'Invalid age interval'),
  get_dataset_info: z.strictObject({ dataset_id: id }),
  get_region_profile: z.strictObject({ region_id: id }),
  get_expression_summary: z.strictObject({ genes: z.array(z.string().regex(/^[A-Za-z0-9.-]{1,40}$/)).min(1).max(5), region: query.optional(), cell_type: query.optional(), weighting: z.enum(['cell_weighted','donor_balanced']).default('cell_weighted'), ...page }),
  get_paper_evidence: z.strictObject({ query, ...page }),
  get_export: z.strictObject({ export_id: id }),
};
export type ToolName = keyof typeof toolSchemas;
