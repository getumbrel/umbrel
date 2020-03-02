#!/bin/sh

HOST=localhost:8080
TLS_CERT=/lnd/tls.cert
MACAROON="$(xxd -p /run/secrets/lnd-admin | tr -d '\n')"
PASS="$(cat /run/secrets/lnd-password | tr -d '\n' | base64 | tr -d '\n')"
UNLOCK_PAYLOAD="$(jq -nc --arg wallet_password ${PASS} '{$wallet_password}')"

lncurl() {
	url_path=$1
	data=$2

	curl  --fail  --silent  --show-error  \
	  --cacert "${TLS_CERT}"  \
	  --header "Grpc-Metadata-macaroon: ${MACAROON}"  \
	  --data "${data}"  \
	  "https://${HOST}/v1/${url_path}"
}

while true; do
	# First make sure that lnd:8080 port is open
	while ! nc -z lnd 8080; do
		>&2 echo "Waiting for ${HOST} port to open…"
		sleep 3
	done
	>&2 echo "Port ${HOST} is open"

	# Wait a bit more in case the port was just opened
	sleep 1

	>&2 echo "Trying ${HOST}/getinfo…"
	INFO=$(lncurl getinfo)
	if [ "$?" = "0" ]; then
		>&2 echo "Response: ${INFO}"
		alias="$(echo "${INFO}" | jq '.alias')"
		>&2 echo "Wallet for ${alias} unlocked!"
		exit 0
	fi
	>&2 echo "${HOST}/getinfo FAILED, out=${INFO}"

	>&2 echo "Trying ${HOST}/unlockwallet…"
	RESULT=$(lncurl unlockwallet "${UNLOCK_PAYLOAD}")
	>&2 echo "${HOST}/unlockwallet completed with: exit-code=$?, out=${RESULT}"

	sleep 16
done
