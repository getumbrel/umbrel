let dojoHost = `${window.location.hostname}:${dojoLocalPort}`;
const dojoBaseRoute = bitcoinNetwork == "testnet" ? "test/v2" : "v2";

if(window.location.hostname.endsWith(".onion")) {
  dojoHost = dojoHiddenService;
}

document.getElementById('dojo-admin-key').innerText = dojoAdminKey;
document.getElementById('whirlpool-api-key').innerText = whirlpoolApiKey;
document.getElementById('whirlpool-hidden-service').innerText = `http://${whirlpoolHiddenService}`;
document.getElementById('dmt-link').setAttribute("href", `http://${dojoHost}/admin/`);

fetch(`http://${dojoHost}/${dojoBaseRoute}/auth/login`, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: `apikey=${dojoAdminKey}`
 })
 .then(response => response.json())
 .then(data => {
    fetch(`http://${window.location.host}/${dojoBaseRoute}/${dojoSupportPrefix}/pairing`, {
        method: 'GET',
        headers: new Headers({
            'Authorization': 'Bearer ' + data.authorizations.access_token,
            'Content-Type': 'application/json'
        })
    })
    .then(response => response.json())
    .then(pairingInfo => {
        pairingInfo.pairing.url = `http://${dojoHiddenService}/${dojoBaseRoute}`;

        const qrcodeSvg = new QRCode({
          content: JSON.stringify(pairingInfo),
          join: true,
          container: "svg-viewbox",
          padding: 3,
          color: "#000000",
          background: "#ffffff",
          ecl: "M",
        }).svg();
        document.querySelector('.qr-contents').innerHTML = qrcodeSvg;
    });
 });
