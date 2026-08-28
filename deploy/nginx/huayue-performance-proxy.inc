# Include inside the exact API proxy locations used by Cashier and Merchant Admin.
proxy_set_header X-Request-ID $request_id;
proxy_hide_header X-Request-ID;
add_header X-Request-ID $request_id always;
access_log /var/log/nginx/huayue-performance.access.log huayue_performance;
