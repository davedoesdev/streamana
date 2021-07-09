#!/bin/bash
# npm install http-server -g
cd "$(dirname $0)/site"
http-server --ssl --cert ../certs/server.crt --key ../certs/server.key
