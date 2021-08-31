#!/bin/bash
cd "$(dirname "$0")/site"
serve -S -l tcp://0.0.0.0 --ssl-cert ../certs/server.crt --ssl-key ../certs/server.key
