#!/bin/bash

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
# IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
# OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
# ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
# OTHER DEALINGS IN THE SOFTWARE.

# Install the docker-compose box to the current working directory
# Pre-requisites: wget

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
    # Update docker-compose
    sed -i 's/mainnet/testnet/g; ' docker-compose.yml
    # TODO: lnd.conf
fi
# REGTEST set and TESTNET not
if [-z $TESTNET ] && [ ! -z $REGTEST ]; then
    echo "Enabling regtest mode if REGTEST variable is set"
    sed -i 's/\#\[regtest\]/\[regtest\]/g;' bitcoin/bitcoin.conf 
    sed -i 's/\#regtest=1/regtest=1/g' bitcoin/bitcoin.conf
    sed -i 's/mainnet/regtest/g; ' docker-compose.yml
fi

echo "Adding tor password"
SAVE_PASSWORD=`tor --hash-password "${RPCPASS}"`
echo "HashedControlPassword ${SAVE_PASSWORD}" >> tor/torrc
echo "Configuring bitcoind"
sed -i "s/torpassword=umbrelftw/torpassword=${RPCPASS}/g;" bitcoin/bitcoin.conf
echo "Configuring LND"
sed -i "s/tor.password=umbrelftw/tor.password=${RPCPASS}/g; " lnd/lnd.conf

rm configure-box.sh
echo "Box Configuration complete"
