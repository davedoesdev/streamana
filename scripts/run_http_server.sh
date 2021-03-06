#!/bin/bash
cd "$(dirname "$0")/../site"
if test "$1" = "--https"; then
  npx serve -S -l tcp://0.0.0.0 --ssl-cert ../certs/server.crt --ssl-key ../certs/server.key
else
  npx serve -S -l tcp://0.0.0.0
fi
