#!/bin/bash -e

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
# EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
# MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
# IN NO EVENT SHALL THE AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR
# OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
# ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
# OTHER DEALINGS IN THE SOFTWARE.

# Install the docker-compose box to the current working directory
# Pre-requisites: git

echo "Cloning to current working directory from github..."
git clone -b v0.1.2 https://github.com/getumbrel/umbrel.git .

echo "Removing stuff we don't need"
rm -fr .git
rm -fr README.md
rm -fr NETWORKING.md
rm -fr CONTRIBUTING.md
rm -fr LICENSE
rm -fr install-box.sh

echo "Installing complete"

