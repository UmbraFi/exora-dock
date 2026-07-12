# api.exoradock.com deployment

This deployment runs the Dock API on a loopback-only container port and exposes it through Nginx HTTPS. Runtime credentials and `data/` are server-local and must never be committed.

1. Copy `config.example.yaml` to `config.yaml` and create an empty `data/` directory.
2. Run `docker compose up -d --build` from this directory.
3. Install `nginx.conf` as the `api.exoradock.com` virtual host and run Certbot with HTTPS redirect enabled.
4. Read the generated `data/auth.json` only through an administrator channel. All `/v1` owner mutations require its owner token.
5. Back up `data/`; Buyer/Seller flows, event logs, payment-PIN state, and delivered artifacts persist there.

Real remote matching uses `POST /v1/buyer-flows/{id}/matching/start?simulation=false`, followed by seller submissions to `POST /v1/buyer-flows/{id}/seller-quotes`. Payment confirmation remains simulated in the current deployment; planning, material review, quote exchange, questions, execution delivery, revisions, acceptance, disputes, and ratings are persisted by the remote Dock.
