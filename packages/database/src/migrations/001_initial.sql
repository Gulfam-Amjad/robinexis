CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prompt_versions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  version INT NOT NULL,
  compiled TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS prompt_versions_client_version_idx
  ON prompt_versions(client_id, version);

CREATE TABLE IF NOT EXISTS call_sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_sessions_client_idx ON call_sessions(client_id);

CREATE TABLE IF NOT EXISTS tool_actions (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  input JSONB,
  result JSONB,
  error TEXT,
  idempotency_key TEXT,
  at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_idem_unique_idx
  ON tool_actions(client_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS outbound_jobs (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  client_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (client_id, phone)
);

CREATE TABLE IF NOT EXISTS call_notes (
  id TEXT PRIMARY KEY,
  payload JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_counters (
  client_id TEXT NOT NULL,
  month TEXT NOT NULL,
  inbound_minutes INT NOT NULL DEFAULT 0,
  outbound_minutes INT NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, month)
);

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('txt', 'markdown', 'pdf')),
  source_uri TEXT,
  mime_type TEXT,
  checksum TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'indexed', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, id)
);

CREATE INDEX IF NOT EXISTS knowledge_documents_client_created_idx
  ON knowledge_documents(client_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS knowledge_documents_client_status_idx
  ON knowledge_documents(client_id, status);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  token_count INT NOT NULL,
  embedding vector(768) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, document_id, chunk_index),
  FOREIGN KEY (client_id, document_id)
    REFERENCES knowledge_documents(client_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS knowledge_chunks_client_document_idx
  ON knowledge_chunks(client_id, document_id, chunk_index);
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_hnsw_idx
  ON knowledge_chunks USING hnsw (embedding vector_cosine_ops);
