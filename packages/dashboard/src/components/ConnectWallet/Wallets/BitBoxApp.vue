<template>
  <connection-details name="BitBoxApp" requires="electrum">
    <step-list>
      <step>
        Make sure Tor is up and running on your system. <b-link v-b-modal.tor-modal>Click here</b-link> for instructions.
      </step>
      <step>
        Open BitBoxApp and go to <span class="font-weight-bold">Settings > Enable tor proxy</span>.
      </step>
      <step>
        Check <span class="font-weight-bold">"Enable tor proxy"</span> and enter:
        <input-copy class="my-1" value="127.0.0.1:9050" auto-width></input-copy>
      </step>
      <step>
        Click <span class="font-weight-bold">"Set proxy address"</span> and restart BitBoxApp.
      </step>
      <step>
        Go to <span class="font-weight-bold">Settings > Connect your own full node</span>.
      </step>
      <step>
        In the <span class="font-weight-bold">"Endpoint"</span>, enter
        <input-copy
          :value="`${urls.bitcoin.electrum.address}:${urls.bitcoin.electrum.port}`"
          auto-width
        ></input-copy>
      </step>
      <step>
        Click <span class="font-weight-bold">"Check"</span> to verify if BitBoxApp is able to connect to your Umbrel.
      </step>
      <step>
        Click <span class="font-weight-bold">"Add"</span> and restart BitBoxApp.
      </step>
      <step>
        Congratulations! You have successfully connected BitBoxApp to your Umbrel.
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
