# Include in the admin API server/location block during deployment.
# Multipart source images: API enforces 20MB each. ZIP imports: API enforces 50MB.
# Leave room for multipart headers; do not alter unrelated upstream/body timeouts.
client_max_body_size 55m;
