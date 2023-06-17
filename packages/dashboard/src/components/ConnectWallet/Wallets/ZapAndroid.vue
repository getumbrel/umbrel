<template>
  <connection-details name="Zap (Android)" requires="lnd">
    <step-list>
      <step>
        Download
        <b-link
          href="https://play.google.com/store/apps/details?id=org.torproject.android"
          target="_blank"
        >Orbot</b-link> on your phone.
      </step>
      <step>
        Open Orbot, tap the gear icon under <span class="font-weight-bold">"Tor-Enabled apps"</span> and add Zap.
      </step>
      <step>
        Tap <span class="font-weight-bold">"STOP"</span>, restart Orbot and turn on
        the <span class="font-weight-bold">"VPN Mode"</span>.
      </step>
      <step>
        Start Tor by tapping the big onion icon.
      </step>
      <step>
        Open the Zap app on your phone.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Connect"</span> on the welcome screen.
      </step>
      <step>
        Scan this QR Code (click to enlarge)
        <qr-code
          :value="urls.lnd.grpcTor.replace(/cert=(.*)&/gm,'')"
          :size="300"
          class="qr-image mt-2"
          showLogo
          @click="$emit('showQrModal', urls.lnd.grpcTor.replace(/cert=(.*)&/gm,'') )"
          v-bind:style="{ cursor: 'pointer' }"
        ></qr-code>
        <hr/>
        <p class="text-muted">Or manually enter the following details</p>
        <ul class="connect-wallet-substeps">
          <li class="connect-wallet-substep">
            Copy
            <input-copy class="my-1" :value="urls.lnd.grpcTor.replace(/cert=(.*)&/gm,'')"></input-copy>
          </li>
          <li class="connect-wallet-substep">
            Tap <span class="font-weight-bold">"Paste"</span> and <span class="font-weight-bold">"Save"</span>.
          </li>
        </ul>
      </step>
      <step>
        Congratulations! You have successfully connected Zap (Android) to your Umbrel.
      </step>
    </step-list>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import InputCopy from "@/components/Utility/InputCopy";
import QrCode from "@/components/Utility/QrCode";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    Step,
    InputCopy,
    QrCode
  }
};
</script>
