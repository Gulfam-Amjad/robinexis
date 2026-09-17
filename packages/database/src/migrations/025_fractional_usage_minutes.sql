-- Runtime and ConvAI calls report sub-minute usage. Preserve those fractions
-- instead of forcing integer-minute counters at the database boundary.
ALTER TABLE usage_counters
  ALTER COLUMN inbound_minutes TYPE NUMERIC(12,4)
    USING inbound_minutes::numeric,
  ALTER COLUMN outbound_minutes TYPE NUMERIC(12,4)
    USING outbound_minutes::numeric;
