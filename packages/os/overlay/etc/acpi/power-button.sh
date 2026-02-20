#!/bin/bash

# Configuration
RECOVERY_SEQUENCE_COUNT=10
LISTEN_TIME=1
STATE_FILE="/tmp/power_button_state"
PASSWORD_RESET_FLAG="/tmp/password_reset_flag"

reset_umbrel_password() {
  yaml_file="/home/umbrel/umbrel/umbrel.yaml"

  echo "umbrel:umbrel" | chpasswd

  if ! [ -f "$yaml_file" ]; then
    echo "Error: File not found."
    return
  fi

  JSON=$(cat "$user_json" 2>/dev/null)

  if ! yq eval . "${yaml_file}" >/dev/null 2>&1; then
    echo "Error: Invalid YAML file."
    return
  fi

  if ! yq -e .user.hashedPassword "${yaml_file}" >/dev/null 2>&1 <<<"$JSON"; then
    echo "Error: Password property not found in the YAML file."
    return
  fi

  yq eval '.user.hashedPassword = "$2b$10$PDwSSnPmfCQJh3x72KjKs.Nb7NgU62gftuic991GkRyFMcIowpTv2"' -i "${yaml_file}"
  yq eval 'del(.user.totpUri)' -i "${yaml_file}"

  echo "Password updated successfully."
}

# Function to handle power button presses
handle_press() {
  # Append the current timestamp to the state file
  echo "$(date +%s)" >> "${STATE_FILE}"

  # Check if the last n button presses happened recently
  num_entries=$(wc -l < "${STATE_FILE}")
  last_timestamps=$(tail -n "${RECOVERY_SEQUENCE_COUNT}" "${STATE_FILE}")
  first_timestamp=$(echo "${last_timestamps}" | head -n 1)
  last_timestamp=$(echo "${last_timestamps}" | tail -n 1)
  total_allowed_duration=$((LISTEN_TIME * RECOVERY_SEQUENCE_COUNT))
  if [[ "${num_entries}" -ge "${RECOVERY_SEQUENCE_COUNT}" ]] && [[ $((last_timestamp - first_timestamp)) -lt "${total_allowed_duration}" ]]; then
    echo "Power button pressed! Recovery sequence detected. Initiating factory reset."
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
  echo "Power button pressed! Listening for additional button presses for ${LISTEN_TIME} seconds..."
  sleep "${LISTEN_TIME}"

  # Read the latest timestamp
  latest_timestamp=$(tail -n 1 "${STATE_FILE}")

  new_num_entries=$(wc -l < "${STATE_FILE}")
  if [[ "${num_entries}" != "${new_num_entries}" ]] || [[ -e "${PASSWORD_RESET_FLAG}" ]]; then
    # Another button press has been registered or a recovery has just been initiated.
    # Exit this handler.
    exit
  fi
}

# Check if we should do any special handling and exit early if we do.
handle_press

# If we get here no special handling is needed and we should trigger a shutdown.
echo "Nothing else happened. Shutting down the system."
poweroff