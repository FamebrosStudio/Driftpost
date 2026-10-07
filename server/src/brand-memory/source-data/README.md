# Famebros brand source data

This folder is the checked-in copy of the supplied `DataSet` folder. It keeps
the master prompt, the consolidated JSON/TXT handoff, and the specific-brand
knowledge files together with the server.

At caption time, Driftpost resolves one canonical `brand_id` and reads only
that brand's record from `Famebros_Brand_Caption_Dataset.json`. The selected
record is added to the prompt alongside the richer operational profile in
`../brands/`. The detailed operational profile takes precedence if the two
records conflict. The full 41-brand dataset is never sent to the model.

When updating a brand, keep its canonical `brand_id` consistent across the
consolidated dataset, compact resolver, and operational profile. Do not fill
unknown contact, location, product, inventory, or commerce fields by guessing.

## Specific-brand snapshots

The files under `Specific-brands/` are research snapshots, not a runtime import
directory. The runtime profile in `../brands/` is what caption generation uses.
Where a brand has duplicate snapshots, use the latest dated/user-approved
snapshot as the source when reconciling the runtime profile:

- `25_Devi_and_Company_Kanpur_AI_Knowledge.json` supersedes snapshot 19.
- `31_Asma_Women_Clothing_AI_Knowledge (2).json` is the current HerChoice by
  Asma profile; the unsuffixed file is an older snapshot.

When changing identity, contacts, or category, update the compact resolver,
`brands.full.json`, the portable dataset, and the runtime profile together.
Keep uncertain/currently changing facts marked as unverified instead of
promoting search snippets or old campaign details to permanent facts.
