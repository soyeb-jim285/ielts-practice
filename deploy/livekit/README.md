# LiveKit deployment assets

The opt-in stack is [`../docker-compose.livekit.yml`](../docker-compose.livekit.yml).
The complete setup, firewall, Cloudflare signaling, TURN/TLS upgrade, credential
handling, smoke checks and rollback procedure are in [`../../docs/livekit.md`](../../docs/livekit.md).

There is deliberately no checked-in `livekit.yaml` containing secret placeholders:
LiveKit does not expand `${ENV}` in its YAML. Compose expands required secrets
into `LIVEKIT_CONFIG` instead. Do not publish rendered Compose output or container
inspection output. No development key, Redis, egress recorder or public metrics
endpoint is enabled by this stack.
