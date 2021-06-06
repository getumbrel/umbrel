document.getElementById('dojo-admin-key').innerText = dojoAdminKey;

var baseRoute = bitcoinNetwork == "testnet" ? "test/v2" : "v2";

fetch(`http://${window.location.host}/${baseRoute}/auth/login`, {
    method: 'POST',
    headers: new Headers({
      'Content-Type': 'application/x-www-form-urlencoded'
    }),
    body: `apikey=${dojoAdminKey}`
 })
 .then(response => response.json())
 .then(data => {
    fetch(`http://${window.location.host}/${baseRoute}/${supportPrefix}/pairing`, {
        method: 'GET',
        headers: new Headers({
            'Authorization': 'Bearer ' + data.authorizations.access_token,
            'Content-Type': 'application/json'
        })
    })
    .then(response => response.json())
    .then(data => {
        var pairingInfo = data;
        pairingInfo.pairing.url = `http://${dojoHiddenService}/${baseRoute}`;

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

        document.getElementById('whirlpool-hidden-service').innerText = `${whirlpoolHiddenService}`;
    });
 });
