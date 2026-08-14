-- Adds a standardised loss/variance CATEGORY to every stock adjustment,
-- recorded ALONGSIDE the existing free-text `reason` (which stays required and
-- unchanged) so shrinkage can be analysed by cause: leak vs evaporation vs
-- dispensing error vs suspected theft.
--
-- Additive only. Nothing about the ledger changes: `stock_movement` rows,
-- `balance_after`, and the cached `tank.current_stock` are untouched, and no
-- stock maths reads this column.
--
-- EXISTING ROWS: the column is NOT NULL, and existing adjustments are
-- referenced by stock_movement.adjustment_id, so they can never be deleted to
-- avoid the backfill. They are labelled DISPENSING_INACCURACY — the neutral
-- "metering/record error" category. Historical rows are deliberately NEVER
-- backfilled as UNAUTHORIZED_EXTRACTION: retroactively labelling an
-- unclassified correction as suspected theft would be a false accusation in an
-- audited record.
--
-- The DEFAULT exists ONLY to make the NOT NULL add succeed, and is dropped in
-- the same migration: from here on the application MUST supply a category, and
-- a code path that forgets one fails loudly at the database instead of silently
-- mis-categorising a loss.

-- CreateEnum
CREATE TYPE "AdjustmentReason" AS ENUM (
    'UNAUTHORIZED_EXTRACTION',
    'DISPENSING_INACCURACY',
    'LEAK_OR_SPILL',
    'EVAPORATION_OR_SLUDGE'
);

-- AlterTable: add the required category, backfilling existing rows.
ALTER TABLE "stock_adjustment"
    ADD COLUMN "reason_category" "AdjustmentReason" NOT NULL DEFAULT 'DISPENSING_INACCURACY';

-- Drop the transitional default: the app is now the only source of the value.
ALTER TABLE "stock_adjustment" ALTER COLUMN "reason_category" DROP DEFAULT;

-- CreateIndex: loss-by-category queries over a date range (adjustment register).
CREATE INDEX "stock_adjustment_reason_category_adjusted_at_idx"
    ON "stock_adjustment" ("reason_category", "adjusted_at");
