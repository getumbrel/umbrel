<template>
  <connection-details name="Sparrow" requires="electrum">
    <step-list>
      <step>
        If you're setting up Sparrow from scratch, click <span class="font-weight-bold">"Configure Server"</span> on the welcome screen.
        If you're already using Sparrow, go to
        <span class="font-weight-bold">Preferences > Server</span>.
      </step>
      <step>
        In the <span class="font-weight-bold">"Type"</span>, select <span class="font-weight-bold">"Private Electrum"</span>
      </step>
      <step>
        For <span class="font-weight-bold">"URL"</span>, enter
        <input-copy class="my-1" :value="urls.bitcoin.electrum.address" auto-width></input-copy>
        <input-copy class="my-1" :value="urls.bitcoin.electrum.port" auto-width></input-copy>
      </step>
      <step>
        Disable <span class="font-weight-bold">"Use SSL"</span>.
      </step>
      <step>
        Click <span class="font-weight-bold">"Test Connection"</span> to verify
        Sparrow is able to connect to your Umbrel.
      </step>
      <step>
        After verifying, click <span class="font-weight-bold">"Close"</span>.
      </step>
      <step>
        Congratulations! You have successfully connected Sparrow to
        your Umbrel.
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
