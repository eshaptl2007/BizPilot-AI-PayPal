-- =====================================================================
-- Migration 002: sign-up with contact number, forgot-password, onboarding
--   * users.phone                 contact number (E.164-style digits, unique when present)
--   * password_reset_tokens       single-use, expiring reset links (only a SHA-256 hash is stored)
--   * businesses.onboarded        FALSE right after sign-up until the owner names the business
-- Existing rows stay valid: phone is nullable and existing businesses default to onboarded = TRUE.
-- =====================================================================
BEGIN;

ALTER TABLE users
  ADD COLUMN phone TEXT CONSTRAINT users_phone_format CHECK (phone ~ '^\+?[0-9]{7,15}$');
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL;

ALTER TABLE businesses
  ADD COLUMN onboarded BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE password_reset_tokens (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT        NOT NULL,                 -- sha256(token); the raw token only ever exists in the email link
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT password_reset_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX password_reset_token_hash_uq ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id, created_at DESC);

COMMIT;
