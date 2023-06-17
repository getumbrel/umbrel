<template>
  <connection-details name="Electrum Wallet (Desktop)" requires="electrum">
    <step-list>
      <step>
        Make sure Tor is up and running on your system.
        <b-link v-b-modal.tor-modal>Click here</b-link> for instructions.
      </step>
      <step>
        Open Electrum Wallet and click the colored dot on the bottom right to open network settings.
      </step>
      <step>
        Uncheck <span class="font-weight-bold">"Select server automatically"</span>.
      </step>
      <step>
        In the <span class="font-weight-bold">"Server"</span>, enter
        <input-copy class="my-1" :value="`${urls.bitcoin.electrum.address}:${urls.bitcoin.electrum.port}:t`" auto-width></input-copy>
      </step>
      <step>
        Go to the <span class="font-weight-bold">"Proxy"</span> tab.
      </step>
      <step>
        Check <span class="font-weight-bold">"Use Tor proxy at port 9050"</span>
      </step>
      <step>
        Click <span class="font-weight-bold">"Close"</span>. Wait for a few seconds and the dot at the bottom right should turn blue.
      </step>
      <step>
        Congratulations! You've successfully connected Electrum Wallet to your Umbrel.
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
