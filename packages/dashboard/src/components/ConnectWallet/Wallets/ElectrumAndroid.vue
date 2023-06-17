<template>
  <connection-details name="Electrum Wallet (Android)" requires="electrum">
    <step-list>
      <step>
        Download
        <b-link
          href="https://play.google.com/store/apps/details?id=org.torproject.android"
          target="_blank"
        >Orbot</b-link> on your phone.
      </step>
      <step>
        Open Orbot, tap the gear icon under <span class="font-weight-bold">"Tor-Enabled apps"</span> and add
        Electrum Wallet.
      </step>
      <step>
        Tap <span class="font-weight-bold">"STOP"</span>, restart Orbot and turn on
         <span class="font-weight-bold">"VPN Mode"</span>.
      </step>
      <step>
        Start Tor by tapping the big onion icon.
      </step>
      <step>
        Open Electrum Wallet, tap the settings icon and select
        <span class="font-weight-bold">"Network"</span>.
      </step>
      <step>
        Set <span class="font-weight-bold">"Auto-connect"</span> to OFF.
      </step>
      <step>
        Set the <span class="font-weight-bold">"Server"</span> setting to
        <input-copy class="my-1" :value="urls.bitcoin.electrum.connectionString" auto-width></input-copy>
      </step>
      <step>
        Congratulations! You have successfully connected Electrum Wallet to your Umbrel.
      </step>
    </step-list>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import InputCopy from "@/components/Utility/InputCopy";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    Step,
    InputCopy
  }
};
</script>
