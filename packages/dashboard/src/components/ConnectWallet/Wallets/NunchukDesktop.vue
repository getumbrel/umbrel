<template>
  <connection-details name="Nunchuk Wallet (Desktop)" requires="electrum">
    <step-list>
      <step>
        Make sure Tor is up and running on your system.
        <b-link v-b-modal.tor-modal>Click here</b-link> for instructions.
      </step>
      <step>
        Open Nunchuk Wallet on your desktop.
      </step>
      <step>
        Go to <span class="font-weight-bold">"Account > Settings"</span>.
      </step>
      <step>
        Under <span class="font-weight-bold">"Network Settings"</span>, select
        <span class="font-weight-bold">"Connect to Electrum server"</span>.
      </step>
      <step>
        Select <span class="font-weight-bold">"Mainnet server"</span> and enter
        <input-copy
          :value="`${urls.bitcoin.electrum.address}:${urls.bitcoin.electrum.port}`"
          auto-width
        ></input-copy>
      </step>
      <step>
        Disable <span class="font-weight-bold">"Set SSL Certificate"</span>.
      </step>
      <step>
        Enable <span class="font-weight-bold">"Enable TOR Proxy"</span>.
      </step>
      <step>
        Click <span class="font-weight-bold">"Save network settings"</span>
      </step>
      <step>
        Congratulations! You've successfully connected Nunchuk Wallet to your Umbrel.
      </step>
    </step-list>

    <b-modal id="tor-modal" centered hide-footer>
      <tor-setup></tor-setup>
    </b-modal>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import TorSetup from "@/components/ConnectWallet/TorSetup.vue";
import InputCopy from "@/components/Utility/InputCopy";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    Step,
    InputCopy,
    TorSetup
  }
};
</script>
