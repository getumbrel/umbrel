ARG IMG
ARG VER

FROM ${IMG}:${VER}

ARG ID=1000
ARG DIR=/data/

RUN addgroup --gid ${ID} lncm

RUN adduser  --uid ${ID} \
             --home ${DIR} \
             --disabled-password \
             --gecos "" \
             --ingroup lncm \
             lncm

USER lncm

VOLUME ${DIR}

