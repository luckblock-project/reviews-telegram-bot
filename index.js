import { config } from 'dotenv';
config();

import ws from 'ws';

import TelegramBot from 'node-telegram-bot-api';
import { fetchTokenStatistics } from '@blockrover/goplus-ai-analyzer-js';

import { checkSendToken } from './check-send-token';

import { JsonDB, Config } from 'node-json-db';
const db = new JsonDB(new Config("db", true, false, '/'));

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
    polling: true
});

const proxy = process.env.PROXY_URL; 
const wsClient = new ws('wss://ws.dextools.io/', proxy ? {
    agent: new HttpsProxyAgent(proxy)
} : {});

wsClient.on('open', function open() {

    wsClient.on('message', async function incoming(data) {
        const res = JSON.parse(Buffer.from(data).toString('utf8')).result;

        require('fs').appendFileSync('log.json', JSON.stringify(res) + '\n', 'utf8')

        if (!res?.data?.pair?.creation) return;
        if (res.data.event !== 'create') return;

        //const main = res.data.pair.token1;
        //const pair = res.data.pair.token0;

        // get the pair that is not weth

        const main = res.data.pair.token0.symbol === 'WETH' ? res.data.pair.token1 : res.data.pair.token0;
        const pair = res.data.pair.token0.symbol === 'WETH' ? res.data.pair.token0 : res.data.pair.token1;

        if (!pair || !main) return;

        const name = main.name;
        const symbol = main.symbol;
        const contractAddress = main.id;

        const pairName = pair.name;
        const pairSymbol = pair.symbol;
        const pairContractAddress = pair.id;

        const data = {
            name,
            symbol,
            contractAddress,
            pairName,
            pairSymbol,
            pairContractAddress
        }

        checkSendToken(data, true);

    });

    console.log('connected');

    wsClient.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: {
            chain: "ether",
            channel: "uni:common"
        },
        id: 1
    }));

    wsClient.send(JSON.stringify({
        jsonrpc: "2.0",
        method: "subscribe",
        params: {
            chain: "ether",
            channel: "uni:pools"
        },
        id: 2
    }));

});


const checkSendToken = async (tokenData, firstTry) => {

    const tokenStatistics = await fetchTokenStatistics(tokenData.contractAddress, tokenData.pairContractAddress);

    if (tokenStatistics.isValidated) {

        const [statistics, initialAuditData] = await Promise.all([
            fetchTokenStatistics(contractAddress),
            fetchAuditData(contractAddress)
        ]);
    
        if (!statistics) return;
    
        const initialAuditIsReady = initialAuditData && initialAuditData.status === 'success';
        const statisticsMessage = formatTokenStatistics(statistics, true, initialAuditIsReady ? JSON.parse(initialAuditData?.data) : null);
    
        const message = await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, statisticsMessage);
    
        if (!initialAuditIsReady) {
    
            triggerAudit(contractAddress);
    
            const ee = new EventEmitter();
            // subscribe to audit changes
            waitForAuditEndOrError(contractAddress, ee);
    
            ee.on('status-update', (status) => {
                console.log(`🤖 ${contractAddress} audit status update: ${status}`);
            });
    
            ee.on('end', (audit) => {
                const auditStatisticsMessage = formatTokenStatistics(statistics, true, audit);
                bot.editMessageText(auditStatisticsMessage, {
                    parse_mode: 'Markdown',
                    message_id: message.message_id,
                    chat_id: chatId
                });
            });
    
            ee.on('error', (error) => {
                console.log(`🤖 ${contractAddress} audit error: ${error}`);
            });
        }
    }
    else if (tokenStatistics.isPartiallyValidated) {
        if (!firstTry) return;
        else {

            bot.sendMessage(process.env.TELEGRAM_CHAT_ID, `⚠️ ${tokenData.name} (${tokenData.symbol}) is partially validated! We will monitor this token for 60 minutes, and we will notify you if the liquidity becomes locked or burnt.`);

            db.push(`/tokens/${tokenData.contractAddress}`, {
                ...tokenData,
                addedAt: Date.now()
            });
        }
    } else {
        console.log(`🤖 ${tokenData.name} (${tokenData.symbol}) is not validated!`);
    }

}

setInterval(() => {

    const tokensToRetry = db.getData('/tokens');

    console.log(`🤖 ${tokensToRetry.length} tokens to retry...`);

    for (const token of tokensToRetry) {
        // if token is added more than 60 minutes ago, remove it from the list
        if (Date.now() - token.addedAt > 60 * 60 * 1000) {
            db.delete(`/tokens/${token.contractAddress}`);
        } else {
            checkSendToken(token, false);
        }
    }

}, 60_000);

console.log(`🤖 blockrover bot is started!`);

process.on('uncaughtException', (er) => {
    console.error(er);
    cleanUpServer();
});

function cleanUpServer() {
    console.log(`🤖 blockrover bot is stopped!`);
    bot.stopPolling({ cancel: true });
    process.exit();
}

[`exit`, `SIGINT`, `SIGUSR1`, `SIGUSR2`, `SIGTERM`].forEach((eventType) => {
    process.on(eventType, cleanUpServer.bind(null, eventType));
});