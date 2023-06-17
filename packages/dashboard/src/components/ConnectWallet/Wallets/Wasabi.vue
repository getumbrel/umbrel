<template>
  <connection-details name="Wasabi" requires="bitcoind">
    <step-list>
      <step>
        Open Wasabi, go to <span class="font-weight-bold">Tools > Settings</span>.
      </step>
      <step>
        Under <span class="font-weight-bold">"Bitcoin P2P Endpoint"</span>, enter
        <input-copy class="my-1" :value="`${urls.bitcoin.p2p.address}:${urls.bitcoin.p2p.port}`" auto-width></input-copy>
      </step>
      <step>
        Restart Wasabi
      </step>
      <step>
        Congratulations! You have successfully connected Wasabi to your Umbrel.
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
