-- 0009_eudr_high_risk_country.sql
--
-- Card 0.20 / plan §7.4 — EU high-risk country reference table.
--
-- WHY A HAND-WRITTEN MIGRATION
--
--   This is a small static reference table that Drizzle-kit COULD
--   generate, but hand-writing is justified by two reasons:
--
--     1. The pre-existing meta/0005_snapshot.json inconsistency
--        (the snapshot references card-0.9 enums that aren't in
--        the schema yet) prevents `db:generate` from running
--        interactively — the TTY prompt about enum schema
--        conflicts hangs the tool. The same workaround as card
--        0.9 / 0.11 applies: hand-write the SQL.
--
--     2. The card body says "Store as a Postgres
--        eudr_high_risk_country table or as a TypeScript constant
--        — implementer's call, but it must be queryable and
--        versioned (an effective_from date column at minimum)".
--        A Postgres table is the most flexible (the tRPC
--        compliance procedure JOINs to it without round-tripping
--        to the TS bundle), so we ship a Postgres table with
--        effective_from dating.
--
-- STATEMENT ORDER
--
--   1. CREATE TABLE with country_code PK + effective_from + source_url.
--   2. Seed v1 baseline: Brazil (BR), Vietnam (VN), Côte d'Ivoire
--      (CI), Ghana (GH), Cameroon (CM), and Democratic Republic of
--      Congo (CD) are the canonical EUDR "high-risk" coffee
--      origins per the European Commission's December 2024
--      benchmarking exercise (plan §9 #17). effective_from = the
--      date of that publication; future updates add new rows
--      with later dates. v1 ships with this baseline.
--   3. Index on effective_from DESC for the "current list" query.

CREATE TABLE IF NOT EXISTS "eudr_high_risk_country" (
  "country_code" text PRIMARY KEY NOT NULL,
  "effective_from" date NOT NULL,
  "source_url" text NOT NULL,
  "notes" text,
  CONSTRAINT "eudr_high_risk_country_iso2_check" CHECK (length("eudr_high_risk_country"."country_code") = 2)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "eudr_high_risk_country_effective_from_idx"
  ON "eudr_high_risk_country" ("effective_from" DESC);

-- v1 baseline (European Commission benchmarking — December 2024).
-- Future updates add new rows with later effective_from dates; the
-- "current list" query is `WHERE effective_from <= now() ORDER BY
-- effective_from DESC LIMIT 1` per country (or a window function
-- if the cardinality grows).
-- ON CONFLICT DO NOTHING — re-running the migration on a DB that
-- already has the v1 baseline (e.g. an operator pre-seeding the
-- list from a published update) is a no-op.
INSERT INTO "eudr_high_risk_country" ("country_code", "effective_from", "source_url", "notes") VALUES
  ('BR', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'Brazil — deforestation-risk cattle + soy overlap'),
  ('VN', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'Vietnam — coffee + rubber'),
  ('CI', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'Côte d''Ivoire — cocoa + coffee'),
  ('GH', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'Ghana — cocoa + coffee'),
  ('CM', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'Cameroon — cocoa + coffee + timber'),
  ('CD', '2024-12-05', 'https://eur-lex.europa.eu/benchmarking/eudr-2024-12', 'DRC — timber + coffee')
ON CONFLICT (country_code) DO NOTHING;

-- ── Verify (read-only — operators run this manually) ─────────────────────
-- SELECT * FROM eudr_high_risk_country ORDER BY country_code;
-- SELECT country_code, effective_from FROM eudr_high_risk_country
--   WHERE effective_from <= now() ORDER BY effective_from DESC LIMIT 10;
