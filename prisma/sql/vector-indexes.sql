-- Prisma does not know the vector type or its indexes, and emits DROP INDEX for them as
-- drift on the next migrate. So they live here instead of in a migration, and `db:indexes`
-- re-applies them after every `db:migrate`. Everything in this file must be idempotent
-- and runnable by the unprivileged application role.

-- A missing extension makes every CREATE INDEX below fail in confusing ways, or silently
-- do nothing if the table is not there yet. Fail loudly and name the fix instead.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
		RAISE EXCEPTION 'pgvector is not installed in this database. Run `bun run db:bootstrap` as a superuser first.';
	END IF;
END $$;

-- Cosine distance (<=>) is the operator lib/db/vector.ts searches with, so the opclass
-- must be vector_cosine_ops. An l2 opclass here would build fine and never be used.
CREATE INDEX IF NOT EXISTS chunk_embedding_hnsw
	ON "Chunk" USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS exemplar_embedding_hnsw
	ON "Exemplar" USING hnsw (embedding vector_cosine_ops);

-- Lexical half of the hybrid search. Postgres ships no Persian configuration, so
-- 'simple' over the already-normalized column is the honest choice: normalizePersian
-- is doing the work a language dictionary would.
CREATE INDEX IF NOT EXISTS chunk_contentnorm_fts
	ON "Chunk" USING gin (to_tsvector('simple', "contentNorm"));

CREATE INDEX IF NOT EXISTS exemplar_questionnorm_fts
	ON "Exemplar" USING gin (to_tsvector('simple', "questionNorm"));
