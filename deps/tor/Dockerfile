# Based on https://github.com/lncm/docker-tor/tree/927ebac9fb43ba4d09249ee27688a4612b7a1707

FROM debian:11-slim as build

ARG VERSION=0.4.7.8

# Add Tor keys
ENV KEYS 514102454D0A87DB0767A1EBBE6A0531C18A9179 B74417EDDF22AC9F9E90F49142E86A2A11F48D36 7A02B3521DC75C542BA015456AFEE6D49E92B601

RUN apt update && \
    # Packages for verification
    apt -y install gpg gpg-agent wget && \
    # Packages for Tor runtime and compilation
    apt -y install libevent-dev libssl-dev zlib1g-dev build-essential

# Download Tor source and checksum
RUN wget https://dist.torproject.org/tor-$VERSION.tar.gz.sha256sum.asc && \
    wget https://dist.torproject.org/tor-$VERSION.tar.gz.sha256sum && \
    wget https://dist.torproject.org/tor-$VERSION.tar.gz

# Verify source
RUN gpg --keyserver keyserver.ubuntu.com --recv-keys $KEYS && \
    gpg --list-keys | tail -n +3 | tee /tmp/keys.txt && \
    gpg --list-keys $KEYS | diff - /tmp/keys.txt && \
    gpg --verify tor-$VERSION.tar.gz.sha256sum.asc && \
    sha256sum -c tor-$VERSION.tar.gz.sha256sum

# Extract source
RUN tar -xzf "/tor-$VERSION.tar.gz"

WORKDIR /tor-$VERSION/

# Build Tor
RUN ./configure --sysconfdir=/etc --datadir=/var/lib && \
    make -j$(nproc) && \
    make install

FROM debian:11-slim

# Copy linked libraries
COPY  --from=build /usr/lib /usr/lib

# Copy Tor binaries
COPY  --from=build /usr/local/bin/tor*  /usr/local/bin/

ENTRYPOINT ["tor"]