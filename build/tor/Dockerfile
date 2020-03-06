FROM alpine:3.11

RUN apk add --no-cache tor

VOLUME /etc/tor/
VOLUME /var/lib/tor/

EXPOSE 9050 9051 29050 29051

ENTRYPOINT ["tor"]
