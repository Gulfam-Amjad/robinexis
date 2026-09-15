ALTER TABLE extracted_facts
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'extracted'
    CHECK (review_status IN ('extracted', 'confirmed', 'edited')),
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
