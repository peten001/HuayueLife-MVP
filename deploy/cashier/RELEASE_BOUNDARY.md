# Merchant Cashier release boundary

Merchant Cashier deployment is static-only. It may publish the built Cashier
assets to the dedicated web release directory, but it must not manage the API
process, copy backend artifacts, or write anywhere below the canonical API
root.

API build, process control, configuration, database migration, and uploads are
separate release responsibilities. A Cashier rollback switches only the
Cashier static release and cannot restart or replace the API.
