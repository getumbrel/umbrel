FROM alpine:3.10

RUN apk add --no-cache curl jq

RUN mkdir /lnd/

COPY unlock.sh /bin/unlock

RUN chmod +x /bin/unlock

ENTRYPOINT ["unlock"]
