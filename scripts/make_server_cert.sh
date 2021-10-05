#!/bin/bash
cd "$(dirname "$0")/../certs"

host=DNS:localhost

for arg in "$@"
do
  case "$arg" in
    --host=*) host="${arg#*=}";;
  esac
done

openssl req -new -nodes -newkey rsa:2048 -keyout server.key -subj "/CN=${host#*:}/" | openssl x509 -req -extfile <(sed "s/SAN/$host/g" extensions) -days 825 -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt
