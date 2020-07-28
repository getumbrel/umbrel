#!/bin/bash -e

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
# IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
# OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
# ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
# OTHER DEALINGS IN THE SOFTWARE.

# Install the docker-compose box to the current working directory
# Pre-requisites: wget

if [ ! $(uname -s) == "Linux" ]; then
  echo "Sorry, only linux systems are supported at this time (you may work around this but you are on your own there)"
  exit 1
fi

check_dependencies () {
  for cmd in "$@"; do
    if ! command -v $cmd >/dev/null 2>&1; then
      echo "This script requires \"${cmd}\" to be installed"
      exit 1
    fi
  done
}

check_dependencies wget docker docker-compose

echo "Start box configuration"
echo "Installing RPCAuth.py and configuring secrets"
cd bin/
wget -q "https://raw.githubusercontent.com/bitcoin/bitcoin/master/share/rpcauth/rpcauth.py" 2>/dev/null
chmod 755 rpcauth.py
./rpcauth.py lncm | tee ../secrets/generated.txt | head -2 | tail -1 > ../secrets/rpcauth.txt
tail -1 ../secrets/generated.txt > ../secrets/rpcpass.txt
rm rpcauth.py ../secrets/generated.txt
cd ..
echo "Installing RPCAuth into bitcoin.conf"
cat secrets/rpcauth.txt >> bitcoin/bitcoin.conf
RPCPASS=`cat secrets/rpcpass.txt`
echo "Configuring LND rpc info"
sed -i "s/RPCPASS/${RPCPASS}/g; " lnd/lnd.conf
echo "Configuring docker-compose file"
sed -i "s/RPCPASS/${RPCPASS}/g; " docker-compose.yml
# TESTNET set and REGTEST not
if [ ! -z $TESTNET ] && [ -z $REGTEST ]; then
    echo "Enabling testnet mode if TESTNET variable is set"
    # Update bitcoin.conf
    sed -i 's/\#\[test\]/\[test\]/g;' bitcoin/bitcoin.conf
    sed -i 's/\#testnet=1/testnet=1/g' bitcoin/bitcoin.conf
    sed -i 's/rpcport=8332/rpcport=18332/g; ' bitcoin/bitcoin.conf
    sed -i 's/port=8332/port=18333/g; ' bitcoin/bitcoin.conf
    echo "Setting testnet port"
    sed -i 's/RPCPORT/18332/g; ' docker-compose.yml
    # Update docker-compose
    sed -i 's/mainnet/testnet/g; ' docker-compose.yml
    # lnd.conf
    echo "Changing LND to testnet mode"
    sed -i 's/bitcoin.mainnet=1/bitcoin.testnet=1/g; ' lnd/lnd.conf
    echo "Updating LND neutrino peers"
    sed -i 's/neutrino.addpeer=bb2.breez.technology/\;neutrino.addpeer=bb2.breez.technology/g; ' lnd/lnd.conf
    sed -i 's/neutrino.addpeer=mainnet1-btcd.zaphq.io/\;neutrino.addpeer=mainnet1-btcd.zaphq.io/g; ' lnd/lnd.conf
    sed -i 's/neutrino.addpeer=mainnet2-btcd.zaphq.io/\;neutrino.addpeer=mainnet2-btcd.zaphq.io/g;' lnd/lnd.conf
    sed -i 's/\;neutrino.addpeer=testnet1-btcd.zaphq.io/neutrino.addpeer=testnet1-btcd.zaphq.io/g;' lnd/lnd.conf
    sed -i 's/\;neutrino.addpeer=testnet2-btcd.zaphq.io/neutrino.addpeer=testnet2-btcd.zaphq.io/g; ' lnd/lnd.conf
fi
# REGTEST set and TESTNET not
if [ -z $TESTNET ] && [ ! -z $REGTEST ]; then
    echo "Enabling regtest mode if REGTEST variable is set"
    sed -i 's/\#\[regtest\]/\[regtest\]/g;' bitcoin/bitcoin.conf
    sed -i 's/\#regtest=1/regtest=1/g' bitcoin/bitcoin.conf
    sed -i 's/rpcport=8332/rpcport=18443/g; ' bitcoin/bitcoin.conf
    sed -i 's/port=8333/port=18444/; ' bitcoin/bitcoin.conf
    sed -i 's/mainnet/regtest/g; ' docker-compose.yml
    echo "Setting regtest port"
    sed -i 's/RPCPORT/18443/g; ' docker-compose.yml
    # Update LND
    echo "Changing LND to regtest mode"
    sed -i 's/bitcoin.mainnet=1/bitcoin.regtest=1/g; ' lnd/lnd.conf
    echo "Updating LND if regtest is set"
    sed -i 's/bitcoin.node=neutrino/bitcoin.node=bitcoind/g; ' lnd/lnd.conf
fi
# if neither set
if [ -z $TESTNET ] && [ -z $REGTEST ]; then
    echo "Setting mainnet RPC port in docker-compose"
    sed -i 's/RPCPORT/8332/g; ' docker-compose.yml
fi

echo "Pulling Docker images"
docker-compose pull

echo "Adding tor password"
SAVE_PASSWORD=$(docker run --rm getumbrel/tor:v0.4.1.9 --quiet --hash-password "${RPCPASS}")
# Add a new line first
echo >> tor/torrc
echo "HashedControlPassword ${SAVE_PASSWORD}" >> tor/torrc

echo "Adding Tor password to bitcoind"
sed -i "s/torpassword=umbrelftw/torpassword=${RPCPASS}/g;" bitcoin/bitcoin.conf
echo "Adding Tor password to LND"
sed -i "s/tor.password=umbrelftw/tor.password=${RPCPASS}/g; " lnd/lnd.conf

rm configure-box.sh
echo "Box Configuration complete"
