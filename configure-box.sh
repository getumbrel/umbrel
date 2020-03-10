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
echo "Configuring invoicer rpc info"
sed -i "s/RPCPASS/${RPCPASS}/g; " invoicer/invoicer.conf
echo "Configuring LND rpc info"
sed -i "s/RPCPASS/${RPCPASS}/g; " lnd/lnd.conf
rm configure-box.sh
echo "Box Configuration complete"

