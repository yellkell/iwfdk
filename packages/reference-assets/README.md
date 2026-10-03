# `@iwsdk/reference-assets`

Producer pipeline and versioned corpus payloads for `@iwsdk/reference`.

This package is not meant to be installed into apps directly. In the monorepo it
owns the offline ingest/build pipeline that generates the reference corpus and
records the pinned model metadata used to build embeddings. The published
package only exposes the compressed `data` warmup payload that
`iwsdk reference warmup` downloads into the shared corpus store. The matching
embedding model files are downloaded from the baked model file URLs used by
`@iwsdk/reference-assets` and `@iwsdk/reference`, so warmup still requires
access to those public pinned model URLs unless the shared cache has already
been pre-warmed.

Useful producer commands:

- `pnpm --filter @iwsdk/reference-assets run build:payload`
  Rebuilds `data/` using the pinned reference model download URLs.
- `pnpm --filter @iwsdk/reference-assets run build:model`
  Rebuilds `model-dist/model.tgz` and also emits `model-dist/rag/`, the raw
  CloudFront-uploadable folder containing `config.json`, `tokenizer.json`,
  `tokenizer_config.json`, and `model_quantized.onnx`.
- `pnpm --filter @iwsdk/reference-assets run build:payload:if-ready`
  Packaging-safe variant that exits cleanly when no existing producer data
  payload is present in the current checkout.
