import test from 'node:test';
import assert from 'node:assert/strict';
import { isGroupWideCaptionBrief } from '../src/ai.js';
import { deepFooter, getDeepBrand } from '../src/brand-memory/index.js';

test('jewellery captions use one branch footer unless the brief explicitly covers the group', () => {
  const profile = getDeepBrand('shree_mahalaxmi_jewellers_kurla');
  assert.ok(profile);
  assert.deepEqual(deepFooter(profile), profile.fixed_footer.kurla_only_lines);
  assert.deepEqual(deepFooter(profile, { groupWide: true }), profile.fixed_footer.group_footer_lines);
  assert.equal(isGroupWideCaptionBrief('Show this gold design at Shree Mahalaxmi Jewellers in Kurla.', profile), false);
  assert.equal(isGroupWideCaptionBrief('Promote this offer across all three stores.', profile), true);
  assert.equal(isGroupWideCaptionBrief('Shree Mahalaxmi Jewellers, Kanchanmala Jewellers and Mahalaxmi Jewellers locations.', profile), true);
});
