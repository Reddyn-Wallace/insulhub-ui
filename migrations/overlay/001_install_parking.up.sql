ALTER TABLE job_install_planning
  ADD COLUMN IF NOT EXISTS parking_notes text NOT NULL DEFAULT '';
