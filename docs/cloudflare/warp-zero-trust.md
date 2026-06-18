# Cloudflare Zero Trust: Headless WARP Enrollment

## Intent
Enroll headless servers (e.g., the ChittyServ cluster) into Cloudflare Zero Trust using WARP in Service Mode. This bypasses the need for manual API authentication (like `CHITTY_AUTH_SERVICE_TOKEN`) because the network egress itself is cryptographically verified by Cloudflare Access.

## Structured Payload
```bash
# Path to the automated enrollment script
bash /home/ubuntu/projects/github.com/CHITTYOS/chittyops/scripts/enroll-warp-service.sh
```

## Metadata
- is_agent_ready: true
- source_type: architecture_session
- success_validated: true
- category: infrastructure
- tags: [cloudflare-one, zero-trust, warp, headless, chittyserv]

## Explanation
By executing the `enroll-warp-service.sh` script, the `warp-cli` daemon registers the VM to your Cloudflare One organization using a Service Token. It then configures `warp-svc` to run constantly in the background.

Any agent running on this node will automatically have its traffic routed through the Cloudflare Zero Trust Gateway. When they hit `connect.chitty.cc`, the Gateway Access policy recognizes the cryptographic device posture of the VM and allows the request to bypass standard JWT auth checks.
