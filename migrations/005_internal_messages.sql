CREATE TABLE team_messages (
 id BIGSERIAL PRIMARY KEY,
 realm_id TEXT NOT NULL,
 sender_sub TEXT NOT NULL,
 recipient_sub TEXT NOT NULL,
 sender_name TEXT NOT NULL,
 body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
 client_key TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 read_at TIMESTAMPTZ,
 CHECK (sender_sub<>recipient_sub),
 UNIQUE(realm_id,sender_sub,client_key)
);
CREATE INDEX team_messages_inbox ON team_messages(realm_id,recipient_sub,id DESC);
CREATE INDEX team_messages_sent ON team_messages(realm_id,sender_sub,recipient_sub,id DESC);
ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_messages_company ON team_messages
 USING (realm_id=current_setting('app.realm_id',true))
 WITH CHECK (realm_id=current_setting('app.realm_id',true));
