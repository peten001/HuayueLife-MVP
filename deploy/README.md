# Production deployment contracts

This directory defines release boundaries; it does not deploy production by
itself.

- `pm2/ecosystem.config.cjs` pins the API process to the canonical source tree.
- `scripts/api-runtime-preflight.sh` fails closed unless the compiled API and
  protected uploads directories already exist.
- `cashier/RELEASE_BOUNDARY.md` keeps Cashier static releases independent from
  the API process and backend files.

An API release may replace only the compiled `dist` artifact after backup and
validation. The `uploads` and `uploads/products` directories are persistent
data and are outside every cleanup, synchronization-delete, and rollback
operation. Production process changes remain a separate, reviewed deployment
step.
