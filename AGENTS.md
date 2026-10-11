# Deployment compatibility

- Local Docker Compose and Alibaba Cloud ACK test/production are long-lived, coexisting environments.
- Keep shared business code. Select MinIO/OSS through configuration; do not remove local MySQL/Redis/MinIO support.
- Test/production inject connection values and secrets at deployment time; never commit actual credentials.
- Cloud schemas are changed by DBA, not application Flyway/startup runners. Provide ordered SQL and explicit handling for any Java migration.
- Production data is imported afresh; never copy local business volumes into cloud environments.
- Applications must support multiple replicas with manual scaling. No HPA is required. Check shared sessions, event fanout, task claiming, locks, temporary files and connection budgets on relevant changes.
- Keep deploy/README.md, configuration templates and verification records aligned with code. Clearly label checks requiring real cloud resources as pending.
- Do not change or restart the user's existing business containers when testing this work; use the isolated ACK smoke stack.
