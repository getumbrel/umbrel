#!/bin/bash

# Configuration
RECOVERY_SEQUENCE_COUNT=10
LISTEN_TIME=1
STATE_FILE="/tmp/power_button_state"
PASSWORD_RESET_FLAG="/tmp/password_reset_flag"

reset_umbrel_password() {
  user_json="/home/umbrel/umbrel/db/user.json"
  new_password='$2b$10$PDwSSnPmfCQJh3x72KjKs.Nb7NgU62gftuic991GkRyFMcIowpTv2'

  # The seed is no longer used for anything but it needs to be present in the user.json file
  # and decryptable by the password for the legacy password change logic to work.
  new_seed='TgXPdw/2PAVunpgU/gC+Mw==$87da593006e88d358f2c8ea6fb060faf$8QPHQcfgevnn$9f16c056e076b30c2d9232c8d945033c12a3c35e97f0f43e50e99d7087adb027$250000$cbc'

  echo "umbrel:umbrel" | chpasswd

  if ! [ -f "$user_json" ]; then
    echo "Error: File not found."
    return
  fi

  JSON=$(cat "$user_json" 2>/dev/null)

  if ! jq -e . >/dev/null 2>&1 <<<"$JSON"; then
    echo "Error: Invalid JSON file."
    return
  fi

  if ! jq -e '.password' >/dev/null 2>&1 <<<"$JSON"; then
    echo "Error: Password property not found in the JSON file."
    return
  fi

  jq --arg new_password "$new_password" --arg new_seed "$new_seed" '.password = $new_password | .seed = $new_seed' <<<"$JSON" >"$user_json"
  echo "Password updated successfully."
}

# Function to handle power button presses
handle_press() {
  echo "Power button pressed!"
  # Append the current timestamp to the state file
  echo "$(date +%s)" >> "${STATE_FILE}"

  # Check if the last n button presses happened recently
  num_entries=$(wc -l < "${STATE_FILE}")
  last_timestamps=$(tail -n "${RECOVERY_SEQUENCE_COUNT}" "${STATE_FILE}")
  first_timestamp=$(echo "${last_timestamps}" | head -n 1)
  last_timestamp=$(echo "${last_timestamps}" | tail -n 1)
  total_allowed_duration=$((LISTEN_TIME * RECOVERY_SEQUENCE_COUNT))
  if [[ "${num_entries}" -ge "${RECOVERY_SEQUENCE_COUNT}" ]] && [[ $((last_timestamp - first_timestamp)) -lt "${total_allowed_duration}" ]]; then
    echo "Recovery sequence detected. Initiating factory reset."
    # This flag indicates that a password reset has been initiated so the previous button presses
    # don't also initiate a reset
    touch "${PASSWORD_RESET_FLAG}"
    reset_umbrel_password

    # Remove the password reset flag after all previous button press event handlers have died
    # so future resets will work.
    sleep "${LISTEN_TIME}"
    rm "${PASSWORD_RESET_FLAG}"
    exit
  fi

  # Listen for additional button presses
  echo "Listening for additional button presses for ${LISTEN_TIME} seconds..."
  sleep "${LISTEN_TIME}"

  # Read the latest timestamp
  latest_timestamp=$(tail -n 1 "${STATE_FILE}")

  if [[ "${latest_timestamp}" -ne "${last_timestamp}" ]] || [[ -e "${PASSWORD_RESET_FLAG}" ]]; then
    # Another button press has been registered or a recovery has just been initiated.
    # Exit this handler.
    exit
  fi

  echo "Nothing else happened."
}

# Check if we should do any special handling and exit early if we do.
handle_press

# If we get here no special handling is needed and we should trigger a shutdown.
echo "Shutting down the system."
poweroff