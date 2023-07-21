const { config } = require('dotenv');
config();

const ws = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');

const TelegramBot = require('node-telegram-bot-api');
const { validateContract, triggerAudit } = require('./analyze');

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

        const pair = res.data.pair.token0;

        if (!pair) return;

        const name = pair.name;
        const symbol = pair.symbol;
        const contractAddress = pair.id;

        const isValidated = await validateContract(contractAddress);

        if (isValidated) {

            triggerAudit(contractAddress);

            let message = `
*Token Name:* ${name}
*Symbol:* ${symbol}
*Chain:* Ethereum
*Contract Address:* ${contractAddress}

AI results:

No honeypot ✅
No blacklist ✅
No modifiable tax ✅
No mint function ✅
No proxy contract ✅
Liquidty locked or burnt ✅

contract is being audited...

Approved by BlockRover Ai ✅

Powered by Blockrover.
            `.trim();
            
            const m = await bot.sendMessage(process.env.TELEGRAM_CHANNEL_ID, message);

            let lastStatus = null;

            let interval = setInterval(async () => {
                fetchAuditStatus(contractAddress)
                .then(async (data) => {
                    console.log(data)
                    if (data.status === 'errored' || data.status === 'unknown') {
                        message = message.replace(`contract is being audited...\n\n`, '');
                        bot.editMessageText(message, {
                            chat_id: process.env.TELEGRAM_CHANNEL_ID,
                            message_id: m.message_id,
                        });
                        clearInterval(interval);
                    }
                    else if (data.status === 'ended') {
                        message = message.replace(`contract is being audited...\n\n`, `[Download Audit Report PDF](https://api.blockrover.io/audit/${contractAddress}/direct-pdf)`);
                            bot.editMessageText(message, {
                                chat_id: process.env.TELEGRAM_CHANNEL_ID,
                                message_id: m.message_id,
                            });
                            clearInterval(interval);
                        }
                        else if (data.status !== lastStatus) {
                            console.log('status changed', data.status);
                            lastStatus = data.status;
                        }
                    });
                }, 2000);

        }

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