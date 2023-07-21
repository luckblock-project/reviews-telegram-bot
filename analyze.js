const triggerAudit = (token) => {
    return fetch(`https://api.blockrover.io/audit/${token}`, {
        method: 'POST'
    })
        .then((data) => data.json());
}

const fetchAuditStatus = (token) => {
    return fetch(`https://api.blockrover.io/audit/${token}/status`)
        .then((data) => data.json());
}

const fetchMarketData = (token) => {
    return fetch(`https://dapp.herokuapp.com/token-market-data?contract=${token}`)
        .then((data) => data.json());
}

const fetchTokenData = (token) => {
    return fetch(`https://dapp.herokuapp.com/token-audit?contract=${token}`)
        .then((data) => data.json());
}

const fetchTokenMarketingWallet = (token) => {
    return fetch(`https://dapp.herokuapp.com/marketing-wallet?contract=${token}`)
        .then((data) => data.json());
}

const fetchAuditData = (token) => {
    return fetch(`https://api.blockrover.io/audit/${token}/json`)
        .then((data) => data.json());
}

const fetchTransactionData = (token) => {
    return fetch(`https://dapp.herokuapp.com/transaction-data?contract=${token}`)
        .then((data) => data.json());
}

const validateContract = async (contractAddress) => {

    const tData = await fetchTokenData(contractAddress).catch(() => null);
    if (!tData || !tData.token_name) {
        throw new Error("Invalid contract address");
    }

    const data = await fetchMarketData(contractAddress).catch(() => null);
    const marketingWalletData = await fetchTokenMarketingWallet(contractAddress).catch(() => null);
    const transactionData = await fetchTransactionData(contractAddress).catch(() => null);

    let tokensInfos = null;
    if (transactionData.data?.txHistory.dexTrades[0]) {
        tokensInfos = getTokensInfos(transactionData.data?.txHistory.dexTrades[0]);
    }

    const holders = tData.lp_holders;

    const isDeadAddress = (address) => address.startsWith("0x0000") || address.endsWith("dead");

    const lockedHolders = holders.filter((h) => !isDeadAddress(h.address) && h.is_locked === 1);
    const burntHolders = holders.filter((h) => isDeadAddress(h.address));

    const lockedPercentage = lockedHolders.map((holder) => parseFloat(holder.percent)).reduce((a, b) => a + b, 0);
    const burntPercentage = burntHolders.map((holder) => parseFloat(holder.percent)).reduce((a, b) => a + b, 0);

    const isLockedOrBurnt = lockedPercentage > 0.9 || burntPercentage > 0.9;

    const isHoneypot = !!parseInt(tData.is_honeypot);
    const isBlacklisted = !!parseInt(tData.is_blacklisted);
    const isMintable = !!parseInt(tData.is_mintable);
    const isProxy = !!parseInt(tData.is_proxy);
    const modifiableTax = !!parseInt(tData.slippage_modifiable);

    const isValidated = !isHoneypot && !isBlacklisted && !isMintable && !isProxy && !modifiableTax && isLockedOrBurnt;

    console.log({
        contractAddress,
        isHoneypot,
        isBlacklisted,
        isMintable,
        isProxy,
        modifiableTax,
        isLockedOrBurnt,
        isValidated
    })

    return isValidated;

}

function getTokensInfos(transaction) {
    const primarySide = transaction.side.toLowerCase();
    const secondarySide = primarySide === "buy" ? "sell" : "buy";
    return {
        primary: {
            symbol: transaction[`${primarySide}Currency`].symbol.toLowerCase(),
            address: transaction[`${primarySide}Currency`].address
        },
        secondary: {
            symbol: transaction[`${secondarySide}Currency`].symbol.toLowerCase(),
            address: transaction[`${secondarySide}Currency`].address
        }
    }
}

module.exports = {
    validateContract,
    triggerAudit,
    fetchAuditStatus
}
