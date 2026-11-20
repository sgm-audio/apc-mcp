---
name: sqlite-media-catalog
description: "SQLite patterns for local media cataloging of audio assets, samples, and projects. Use when designing or reviewing a local catalog schema, queries, or indexing for audio files, metadata, and search."
type: workflow
lifecycle: active
---

# SQLite Media Catalog

## Schema Principles
- Store file path (absolute or relative to a root), size, mtime, and a content hash.
- Separate tables for tags, projects, and samples. Use junction tables for many-to-many.
- Index on hash, mtime, and common search fields (sample rate, channels, duration).

## Performance
- Use `WITHOUT ROWID` only when the primary key is a stable integer or hash that is the natural key.
- Batch inserts inside a single transaction.
- Prefer `FTS5` for filename/tag search over `LIKE '%foo%'`.

## Safety
- Never store absolute paths that break when the library moves — store relative + a configurable root.
- Vacuum and analyze periodically on large catalogs.
