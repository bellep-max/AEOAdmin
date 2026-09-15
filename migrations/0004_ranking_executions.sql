-- Additive: historical ranking_reports remain typed imports and are not rewritten.
BEGIN;
CREATE TABLE IF NOT EXISTS execution_workers (
  id text PRIMARY KEY,
  devices jsonb NOT NULL DEFAULT '[]',
  modes jsonb NOT NULL DEFAULT '[]',
  last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ranking_executions (
  id uuid PRIMARY KEY,
  keyword_id integer NOT NULL REFERENCES keywords(id),
  mode text NOT NULL CHECK (mode IN ('type','voice')),
  platform text NOT NULL CHECK (platform IN ('chatgpt','gemini','copilot','bing')),
  worker_id text NOT NULL REFERENCES execution_workers(id),
  device_serial text NOT NULL,
  hardware_id text NOT NULL,
  request jsonb NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','success','error','cancelled')),
  cancel_requested boolean NOT NULL DEFAULT false,
  result jsonb,
  result_sha256 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ranking_execution_phone_lease ON ranking_executions(hardware_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS ranking_execution_queue ON ranking_executions(worker_id,status,created_at);
CREATE TABLE IF NOT EXISTS execution_artifacts (
  execution_id uuid NOT NULL REFERENCES ranking_executions(id),
  artifact_id integer NOT NULL,
  name text NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('audio/wav','image/png')),
  sha256 text NOT NULL,
  size integer NOT NULL CHECK (size BETWEEN 1 AND 20971520),
  storage_key text NOT NULL,
  uploaded boolean NOT NULL DEFAULT false,
  PRIMARY KEY(execution_id, artifact_id)
);
COMMIT;
