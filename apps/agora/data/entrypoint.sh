#!/usr/bin/env sh

# Update configs
/filebrowser config init
/filebrowser config set --branding.name "Agora Admin"
/filebrowser users add umbrel ${APP_PASSWORD}

exec /filebrowser
