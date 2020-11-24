# Frequently asked questions

### Does Umbrel support .....?
Currently not, but the Umbrel team is working on an application infrastructure, so third-party developers can add their own apps to Umbrel.
Depending on the feature you want, it might even be added to Umbrel itself in the future.

### My Umbrel node keeps crashing. What can I do to fix the issue?
If you're not using the official power supply, it's probably the power supply. To detect undervoltage, connect to your node via SSH and run this command vcgencmd get_throttled. If it doesn't output throttled=0x0, then it's either the power supply or your SSD is using too much power (this can only be the case if you're not using the recommended hardware.

### My Umbrel node doesn't boot. What can I do?
Do you have connected anything to the GPIO pins? If yes, try to unplug it and reboot the RPi by unplugging the power supply and then plugging it back in.

### I can't access the dashboard at umbrel.local. What can I do?
Check if your router detects your node. If it does, try to access it with the IP address directly, if it doesn't, either you ethernet cable isn't plugged in correctly or the node doesn't boot. If the ethernet cable isn't the issue, follow the answer of the previous question. If you can't access the dashboard via the IP address either, try to disconnect the drive from the Raspberry Pi and plug it into the other USB port. Then SSH into your node and run: sudo systemctl start umbrel-external-storage, wait for two minutes, then run sudo systemctl status umbrel-external-storage. If the output of that command contains "Exiting the mount script without anything", the drive is connected wrongly. If the output doesn't contain this text, run sudo systemctl start umbrel-startup. You should now be able to access the dashboard.

### What are the SSH username and password?
The username is `umbrel`, the password is `moneyprintergobrrr`.

### I want to connect to my node using ...... over my local network, but it doesn't work. How can I fix this?
If you want to connect to your Umbrel over the local network just replace your onion domain with umbrel.local for any of the connection strings

### How can I use WiFi instead of ethernet?
This works like it does in RaspiBlitz: Follow this tutorial after flashing the SD card, but before inserting it into the Raspberry Pi: https://stadicus.github.io/RaspiBolt/raspibolt_20_pi.html#prepare-wifi

If this doesn't help, ask in the Telegram chat for answers.
