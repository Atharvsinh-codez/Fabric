CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text,
  email_verified timestamptz,
  image text,
  suspended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX users_email_unique ON users (email);
--> statement-breakpoint

CREATE TABLE accounts (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at integer,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT accounts_provider_provider_account_id_pk
    PRIMARY KEY (provider, provider_account_id),
  CONSTRAINT accounts_identity_only_tokens_redacted
    CHECK (access_token IS NULL AND refresh_token IS NULL AND id_token IS NULL)
);
--> statement-breakpoint

CREATE INDEX accounts_user_id_idx ON accounts (user_id);
--> statement-breakpoint

COMMENT ON CONSTRAINT accounts_identity_only_tokens_redacted ON accounts IS
  'Fabric OAuth is identity-only; provider bearer and identity tokens are discarded before persistence.';
--> statement-breakpoint

CREATE TABLE sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX sessions_id_unique ON sessions (id);
--> statement-breakpoint
CREATE INDEX sessions_user_id_expires_idx ON sessions (user_id, expires);
--> statement-breakpoint

CREATE TABLE verification_tokens (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  CONSTRAINT verification_tokens_identifier_token_pk PRIMARY KEY (identifier, token)
);
--> statement-breakpoint

CREATE INDEX verification_tokens_expires_idx ON verification_tokens (expires);
--> statement-breakpoint

CREATE TABLE session_metadata (
  session_id uuid PRIMARY KEY REFERENCES sessions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  device_label text,
  user_agent_family text,
  ip_hash text,
  reauthenticated_at timestamptz,
  reauthentication_method text,
  revoked_at timestamptz,
  revocation_reason text
);
--> statement-breakpoint

CREATE INDEX session_metadata_last_seen_at_idx ON session_metadata (last_seen_at);
--> statement-breakpoint

CREATE TABLE account_link_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  provider text NOT NULL,
  state_hash text NOT NULL,
  nonce_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  provider_account_id text,
  provider_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT account_link_intents_provider_check CHECK (provider IN ('google', 'github')),
  CONSTRAINT account_link_intents_status_check
    CHECK (status IN ('pending', 'consumed', 'expired', 'cancelled')),
  CONSTRAINT account_link_intents_expiry_check CHECK (expires_at > created_at)
);
--> statement-breakpoint

CREATE UNIQUE INDEX account_link_intents_state_hash_unique
  ON account_link_intents (state_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX account_link_intents_nonce_hash_unique
  ON account_link_intents (nonce_hash);
--> statement-breakpoint
CREATE INDEX account_link_intents_user_status_idx
  ON account_link_intents (user_id, status);
--> statement-breakpoint
CREATE INDEX account_link_intents_expires_at_idx
  ON account_link_intents (expires_at);
--> statement-breakpoint

CREATE TABLE account_security_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  event_type text NOT NULL,
  provider text,
  session_id uuid REFERENCES sessions (id) ON DELETE SET NULL,
  ip_hash text,
  user_agent_family text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX account_security_events_user_created_at_idx
  ON account_security_events (user_id, created_at);
--> statement-breakpoint
CREATE INDEX account_security_events_event_type_idx
  ON account_security_events (event_type);
