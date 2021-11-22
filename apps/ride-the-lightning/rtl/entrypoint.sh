#!/usr/bin/env sh

# Migrate legacy default password
sed -i 's/"multiPassHashed": "70c882380045d35807b45245bd49185991904ff47a5036dfe82103c49f9f0f31"/"multiPass": "'${APP_PASSWORD}'"/' $RTL_CONFIG_PATH/RTL-Config.json
sed -i 's/"multiPass": "moneyprintergobrrr"/"multiPass": "'${APP_PASSWORD}'"/' $RTL_CONFIG_PATH/RTL-Config.json

# Migrate new password placeholder
sed -i 's/$APP_PASSWORD/'${APP_PASSWORD}'/' $RTL_CONFIG_PATH/RTL-Config.json

exec /sbin/tini -g -- node rtl
