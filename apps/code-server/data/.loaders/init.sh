lazy_load() {
  local command="${1}"
  local loader="${2}"
  local arguments=${@:3}
  if ! which $command > /dev/null 2>&1
  then
    echo "${command} isn't installed yet, installing it now..."
    $loader
    echo "${command} installed! Running \"${command} ${arguments}\"..."
    echo
  fi
  $command $arguments
}

setup_node() {
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.38.0/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  source "${HOME}/.nvm/nvm.sh"
  source "${HOME}/.nvm/bash_completion"
  nvm install stable
}

setup_python() {
  sudo apt-get update
  sudo apt-get install -y python3 python3-pip
}

setup_rust() {
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  source "${HOME}/.cargo/env"
}

alias node="lazy_load node setup_node"
alias npm="lazy_load npm setup_node"
alias python3="lazy_load python3 setup_python"
alias pip3="lazy_load pip3 setup_python"
alias python="python3"
alias pip="pip3"
alias rustup="lazy_load rustup setup_rust"
alias rustc="lazy_load rustc setup_rust"
alias cargo="lazy_load cargo setup_rust"
