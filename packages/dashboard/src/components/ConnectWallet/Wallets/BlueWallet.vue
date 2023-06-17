<template>
  <connection-details name="BlueWallet" requires="electrum">
    <step-list>
      <step>
        Install the <b-link to="/app-store/bluewallet">BlueWallet Lightning</b-link> app on your Umbrel.
      </step>
      <step>
        Open BlueWallet on your phone, tap the three dots to access the settings and go to
        <span class="font-weight-bold">Network > Lightning Settings</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Scan or import a file"</span>.
      </step>
      <step>
        Scan the QR code displayed in the <b-link to="/app-store/bluewallet">BlueWallet Lightning</b-link> app on your Umbrel.
      </step>
      <step>
          Tap <span class="font-weight-bold">"Save"</span>.
      </step>
      <step>
        Now go to
        <span class="font-weight-bold">Network > Electrum Server</span>.
      </step>
      <step>
        Tap <span class="font-weight-bold">"Scan or import a file"</span>.
      </step>
      <step>
        Scan this QR Code (click to enlarge)
        <qr-code
          :value="`${urls.bitcoin.electrum.address}:${urls.bitcoin.electrum.port}`"
          :size="300"
          class="qr-image mt-2"
          showLogo
          @click="$emit('showQrModal', `${urls.bitcoin.electrum.address}:${urls.bitcoin.electrum.port}`)"
          v-bind:style="{ cursor: 'pointer' }"
        ></qr-code>
      </step>
      <step>
          Tap <span class="font-weight-bold">"Save"</span> and restart BlueWallet.
      </step>
      <step>
        Congratulations! You have successfully connected BlueWallet to your Umbrel.
      </step>
    </step-list>
  </connection-details>
</template>

<script>
import ConnectionDetails from "@/components/ConnectWallet/ConnectionDetails";
import StepList from "@/components/ConnectWallet/StepList";
import Step from "@/components/ConnectWallet/Step";
import QrCode from "@/components/Utility/QrCode";

export default {
  props: {
    urls: Object
  },
  components: {
    ConnectionDetails,
    StepList,
    Step,
    QrCode
  }
};
</script>
