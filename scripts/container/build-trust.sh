#!/bin/sh
# Sourced inside a RUN with an optional corporate_ca secret. Never persists trust material.
if [ -s /run/secrets/corporate_ca ]; then
  cat /etc/ssl/certs/ca-certificates.crt /run/secrets/corporate_ca > /tmp/xcsh-build-ca.pem
  export SSL_CERT_FILE=/tmp/xcsh-build-ca.pem CURL_CA_BUNDLE=/tmp/xcsh-build-ca.pem
  export REQUESTS_CA_BUNDLE=/tmp/xcsh-build-ca.pem PIP_CERT=/tmp/xcsh-build-ca.pem
  export GIT_SSL_CAINFO=/tmp/xcsh-build-ca.pem CARGO_HTTP_CAINFO=/tmp/xcsh-build-ca.pem
  export NODE_EXTRA_CA_CERTS=/run/secrets/corporate_ca
  trap 'rm -f /tmp/xcsh-build-ca.pem' EXIT
fi
