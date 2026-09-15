-- Provisioning may be deliberately paused by an operator. Readiness evidence is
-- retained in provisioning_runs.output and activation remains a separate,
-- transactional owner action.

ALTER TABLE provisioning_runs DROP CONSTRAINT IF EXISTS provisioning_runs_status_check;
ALTER TABLE provisioning_runs
  ADD CONSTRAINT provisioning_runs_status_check
  CHECK (status IN ('pending', 'running', 'paused', 'succeeded', 'failed', 'cancelled'));

ALTER TABLE onboarding_jobs DROP CONSTRAINT IF EXISTS onboarding_jobs_status_check;
ALTER TABLE onboarding_jobs
  ADD CONSTRAINT onboarding_jobs_status_check
  CHECK (status IN ('pending', 'leased', 'paused', 'completed', 'dead_letter'));
