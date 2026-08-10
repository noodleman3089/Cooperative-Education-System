-- Migration SEC-01: bind personnel_preseed_list rows to a single verified identity.
--
-- Before this change POST /api/auth/claim-personnel accepted any employee_code from
-- any authenticated user, so a student could claim an unclaimed 'dean' row and be
-- granted that role. The claim now additionally requires the authenticated account's
-- email to match `email` below, and rows without an email can no longer be claimed.

ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS claimed_by INT REFERENCES users(user_id) ON DELETE SET NULL;
ALTER TABLE personnel_preseed_list ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP;

-- One employee_code per email.
CREATE UNIQUE INDEX IF NOT EXISTS uq_personnel_preseed_email
  ON personnel_preseed_list (email) WHERE email IS NOT NULL;

-- SEC-02: the same binding for students. Without it, a student whose SSO email is
-- name-based could claim a classmate's student_code at profile setup and inherit
-- that classmate's imported eligibility and GPA.
ALTER TABLE eligible_students_list ADD COLUMN IF NOT EXISTS email VARCHAR(255);

-- SEC-07: append-only audit trail for privileged and irreversible actions.
CREATE TABLE IF NOT EXISTS audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    actor_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    actor_email VARCHAR(255),
    actor_roles TEXT,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id VARCHAR(100),
    subject_id INT,
    detail JSONB,
    ip_address VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_subject ON audit_log (subject_id);
