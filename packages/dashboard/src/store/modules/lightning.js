import API from "@/helpers/api";
import { toPrecision } from "@/helpers/units";
// import Events from '~/helpers/events';
// import { sleep } from '@/helpers/utils';

// Helper function to sort lightning transactions by date
// function sortTransactions(a, b) {
//     if (a.creationDate > b.creationDate) {
//         return -1;
//     }

//     if (a.creationDate < b.creationDate) {
//         return 1;
//     }

//     return 0;
// }

// Initial state
const state = () => ({
  operational: false,
  unlocked: false,
  version: "",
  currentBlock: 0,
  blockHeight: 0,
  percent: -1, //for loading state
  balance: {
    total: -1,
    confirmed: -1,
    pending: -1
  },
  alias: "",
  pubkey: "",
  lndConnectUrls: {
    restTor: "",
    restLocal: "",
    grpcTor: "",
    grpcLocal: ""
  },
  uris: [],
  numPendingChannels: 0,
  numActiveChannels: -1,
  numPeers: -1,
  channels: [
    { type: "loading" },
    { type: "loading" },
    { type: "loading" },
    { type: "loading" }
  ],
  connectionCode: "unknown",
  maxSend: -1,
  maxReceive: -1,
  transactions: [
    { type: "loading" },
    { type: "loading" },
    { type: "loading" },
    { type: "loading" }
  ],
  confirmedTransactions: [],
  pendingTransactions: [],
  pendingChannelEdit: {}
});

// Functions to update the state directly
const mutations = {
  isOperational(state, operational) {
    state.operational = operational;
  },

  setSync(state, sync) {
    state.percent = Number(toPrecision(parseFloat(sync.percent) * 100, 2));
    state.blockHeight = sync.knownBlockCount;
    state.currentBlock = sync.processedBlocks;
  },

  isUnlocked(state, unlocked) {
    state.unlocked = unlocked;
  },

  setVersion(state, version) {
    state.version = version;
  },

  setConnectionCode(state, code) {
    state.connectionCode = code;
  },

  setNumPeers(state, numPeers) {
    state.numPeers = numPeers;
  },

  setNumActiveChannels(state, numActiveChannels) {
    state.numActiveChannels = numActiveChannels;
  },

  setChannels(state, channels) {
    state.channels = channels;
  },

  setChannelFocus(state, channel) {
    state.pendingChannelEdit = channel;
  },

  setBalance(state, balance) {
    if (balance.confirmed !== undefined) {
      state.balance.confirmed = parseInt(balance.confirmed);
    }

    if (balance.pending !== undefined) {
      state.balance.pending = parseInt(balance.pending);
    }

    state.balance.total = state.balance.confirmed;
  },

  setMaxReceive(state, maxReceive) {
    state.maxReceive = maxReceive;
  },

  setMaxSend(state, maxSend) {
    state.maxSend = maxSend;
  },

  setTransactions(state, transactions) {
    state.transactions = transactions;
  },

  setConfirmedTransactions(state, confirmedTransactions) {
    state.confirmedTransactions = confirmedTransactions;
  },

  setPendingTransactions(state, pendingTransactions) {
    state.pendingTransactions = pendingTransactions;
  },

  setPubKey(state, pubkey) {
    state.pubkey = pubkey;
  },

  setAlias(state, alias) {
    state.alias = alias;
  },

  setUris(state, uris) {
    state.uris = uris;
  },

  setLndConnectUrls(state, urls) {
    state.lndConnectUrls = urls;
  }
};

// Functions to get data from the API
const actions = {
  async getStatus({ commit }) {
    const status = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/info/status`
    );
    if (status) {
      commit("isOperational", status.operational);
      commit("isUnlocked", status.unlocked);
    }

    // launch unlock modal after 30 sec
    // if (!status.unlocked) {
    //   await sleep(30000);
    //   const { unlocked } = await API.get(`${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/info/status`);
    //   commit('isUnlocked', unlocked);
    //   if (!unlocked) {
    //     Events.$emit('unlock-modal-open');
    //   }
    // }
  },

  async getSync({ commit }) {
    const sync = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/info/sync`
    );
    if (sync && sync.percent) {
      commit("setSync", sync)
    }
  },

  //basically fetches everything
  async getLndPageData({ commit, dispatch }) {
    const data = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/pages/lnd`
    );

    if (data) {
      const channels = data.channels || [];
      dispatch("getChannels", channels);

      const lightningInfo = data.lightningInfo;

      commit("setAlias", lightningInfo.alias);
      commit("setUris", lightningInfo.uris);
      commit("setPubKey", lightningInfo.identityPubkey);
      commit("setVersion", lightningInfo.version);
      commit("setNumPeers", lightningInfo.numPeers);
      commit("setNumActiveChannels", lightningInfo.numActiveChannels);
    }
  },

  async getConnectionCode({ commit }) {
    const uris = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/info/uris`
    );

    if (uris && uris.length > 0) {
      commit("setConnectionCode", uris[0]);
    } else {
      commit("setConnectionCode", "Could not determine lnd connection code");
    }
  },

  // Deprecated, this endpoint returns balance data minus estimated channel closing fees
  // These estimates have caused many customers to be confused by the numbers displayed in the dashboard (leaky sats)
  // Instead we can calculate our total balance by getting the sum of each channel's localBalance
  async getBalance({ commit }) {
    const balance = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/wallet/lightning`
    );

    if (balance) {
      commit("setBalance", { confirmed: balance.balance });
    }
  },

  async getChannels({ commit }, preFetchedChannels = []) {
    let rawChannels;

    if (preFetchedChannels.length) {
      //eg when used by lnd page
      rawChannels = preFetchedChannels;
    } else {
      rawChannels = await API.get(
        `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/channel`
      );
    }

    const channels = [];
    let confirmedBalance = 0;
    let pendingBalance = 0;
    let maxReceive = 0;
    let maxSend = 0;

    if (rawChannels) {
      // Loop through channels to determine pending balance, max payment amount, and sort channels by type
      rawChannels.forEach(channel => {
        const localBalance = parseInt(channel.localBalance) || 0;
        const remoteBalance = parseInt(channel.remoteBalance) || 0;

        if (channel.type === "OPEN") {
          if (channel.active) {
            channel.status = "Online";
          } else {
            channel.status = "Offline";
          }

          //max receive = max remote balance in a channel
          //max send = max local balance in a channel

          // if (remoteBalance > maxReceive) {
          //   maxReceive = remoteBalance;
          // }

          // if (localBalance > maxSend) {
          //   maxSend = localBalance;
          // }

          maxReceive += remoteBalance;
          maxSend += localBalance;

          confirmedBalance += localBalance;
        } else if (channel.type === "PENDING_OPEN_CHANNEL") {
          pendingBalance += localBalance;
          channel.status = "Opening";
        } else if (
          [
            "WAITING_CLOSING_CHANNEL",
            "FORCE_CLOSING_CHANNEL",
            "PENDING_CLOSING_CHANNEL"
          ].indexOf(channel.type) > -1
        ) {
          pendingBalance += localBalance;
          channel.status = "Closing";

          // Lnd doesn't provide initiator or autopilot data via rpc. So, we just display a generic closing message.
          channel.name = "Closing Channel";
          channel.purpose = "A channel that is in the process of closing";
        } else {
          channel.status = "Unknown";
        }

        if (channel.name === "" && !channel.initiator) {
          channel.name = "Inbound Channel";
          channel.purpose = "A channel that another node has opened to you";
        }

        // Set placeholder values if autopilot
        if (channel.managed === false && channel.initiator) {
          channel.name = "Autopilot";
          channel.purpose = "Managed by autopilot";
        }

        channels.push(channel);
      });
      commit("setChannels", channels);
      commit("setBalance", {
        confirmed: confirmedBalance,
        pending: pendingBalance
      });
      commit("setMaxReceive", maxReceive);
      commit("setMaxSend", maxSend);
    }
  },

  async getTransactions({ commit, state }) {
    // Get invoices and payments
    const invoices = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/invoices`
    );
    const payments = await API.get(
      `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/payments`
    );

    if (!invoices || !payments) {
      return;
    }

    let transactions = [];
    let incomingTransactions = [];
    let outgoingTransactions = [];

    if (invoices) {
      incomingTransactions = invoices.map(tx => {
        let type = "incoming";
        if (tx.state === "CANCELED") {
          type = "expired";
        } else if (tx.state === "OPEN") {
          type = "pending";
        }
        return {
          type,
          amount: Number(tx.value),
          timestamp: tx.settled
            ? new Date(Number(tx.settleDate) * 1000)
            : new Date(Number(tx.creationDate) * 1000),
          description: tx.memo || "",
          expiresOn: new Date(
            (Number(tx.creationDate) + Number(tx.expiry)) * 1000
          ),
          paymentRequest: tx.paymentRequest
        };
      });
      transactions = [...transactions, ...incomingTransactions];
    }

    if (payments) {
      outgoingTransactions = payments.map(tx => {
        //load tx from state to copy description
        const preFetchedTx = state.transactions.find(
          trx =>
            trx.type === "outgoing" &&
            trx.paymentPreImage === tx.paymentPreimage
        );

        return {
          type: "outgoing",
          amount: Number(tx.value),
          timestamp: new Date(Number(tx.creationDate) * 1000),
          paymentRequest: tx.paymentRequest,
          paymentPreImage: tx.paymentPreimage,
          fee: Number(tx.feeSat),
          description: preFetchedTx ? preFetchedTx.description : ""
        };
      });

      transactions = [...transactions, ...outgoingTransactions];
    }

    //Sort by recent to oldest
    transactions.sort((tx1, tx2) => tx2.timestamp - tx1.timestamp);

    //filter out new outgoing payments
    const newOutgoingTransactions = outgoingTransactions.filter(
      tx =>
        !state.transactions.some(
          trx => trx.paymentPreImage === tx.paymentPreImage
        )
    );

    //update $store
    commit("setTransactions", transactions);

    // Fetch descriptions of all new outgoing transactions
    for (let tx of newOutgoingTransactions) {
      if (!tx.paymentRequest) {
        //example - in case of a keysend tx there is no payment request
        continue;
      }

      try {
        const invoiceDetails = await API.get(
          `${process.env.VUE_APP_MIDDLEWARE_API_URL}/v1/lnd/lightning/invoice?paymentRequest=${tx.paymentRequest}`
        );
        if (invoiceDetails && invoiceDetails.description) {
          //load state's txs
          const updatedTransactions = state.transactions;

          //find tx to update
          const txIndex = updatedTransactions.findIndex(
            trx => trx.paymentPreImage === tx.paymentPreImage
          );

          if (txIndex !== -1) {
            const outgoingTx = updatedTransactions[txIndex];
            //update tx description and state
            outgoingTx.description = invoiceDetails.description;
            commit("setTransactions", transactions);
          }
        }
      } catch (error) {
        // console.log(error);
      }
    }
  },

  selectChannel({ commit }, channel) {
    commit("setChannelFocus", channel);
  },

  async getLndConnectUrls({ commit }) {
    const urls = await API.get(
      `${process.env.VUE_APP_MANAGER_API_URL}/v1/system/lndconnect-urls`
    );
    if (urls) {
      commit("setLndConnectUrls", urls);
    }
  }
};

const getters = {
  status(state) {
    const data = {
      class: "loading",
      text: "Loading..."
    };

    if (state.operational) {
      if (state.unlocked) {
        data.class = "active";
        data.text = "Active";
      } else {
        data.class = "inactive";
        data.text = "Locked";
      }
    }

    return data;
  }
};

export default {
  namespaced: true,
  state,
  getters,
  actions,
  mutations
};
