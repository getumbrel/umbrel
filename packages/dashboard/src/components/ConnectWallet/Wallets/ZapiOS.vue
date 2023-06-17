<template>
  <connection-details name="Zap (iOS)" requires="lnd">
    <step-list>
      <step>
        Open the Zap app on your iPhone.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Connect"</span> on the welcome screen.
      </step>
      <step>
        Scan this QR Code (click to enlarge)
        <qr-code
          :value="urls.lnd.restTor.replace(/cert=(.*)&/gm,'')"
          :size="300"
          class="qr-image mt-2"
          showLogo
          @click="$emit('showQrModal', urls.lnd.restTor.replace(/cert=(.*)&/gm,''))"
          v-bind:style="{ cursor: 'pointer' }"
        ></qr-code>
        <hr/>
        <p class="text-muted">Or manually enter the following details</p>
        <ul class="connect-wallet-substeps">
          <li class="connect-wallet-substep">
            Copy <input-copy class="my-1" :value="urls.lnd.restTor.replace(/cert=(.*)&/gm,'')"></input-copy>
          </li>
          <li class="connect-wallet-substep">
            Tap <span class="font-weight-bold">"Paste"</span> and <span class="font-weight-bold">"Save"</span>.
          </li>
        </ul>
      </step>
      <step>
        Tap <span class="font-weight-bold">"Connect"</span>
      </step>
      <step>
        Congratulations! You have successfully connected Zap (iOS) to your Umbrel.
      </step>
    </step-list>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import InputCopy from "@/components/Utility/InputCopy.vue";
import QrCode from "@/components/Utility/QrCode";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    InputCopy,
    Step,
    QrCode
  }
};
</script>
