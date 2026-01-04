const { HandCashConnect } = require('@handcash/handcash-connect');

async function pay(note) {
    const appId = process.env.HANDCASH_APP_ID;
    const appSecret = process.env.HANDCASH_APP_SECRET;
    const authToken = process.env.HANDCASH_AUTH_TOKEN;
    const treasury = process.env.BGIT_TREASURY_HANDLE || '$b0ase';

    if (!appId || !appSecret || !authToken) {
        console.error('Missing HandCash Credentials (APP_ID, APP_SECRET, or AUTH_TOKEN)');
        return;
    }

    try {
        const handCashConnect = new HandCashConnect({
            appId: appId,
            appSecret: appSecret,
        });
        const account = handCashConnect.getAccountFromAuthToken(authToken);

        const paymentParameters = {
            description: note || 'bGit Commit',
            payments: [
                { destination: treasury, currencyCode: 'BSV', sendAmount: 0.001 }
            ]
        };

        const result = await account.wallet.pay(paymentParameters);
        console.log(`[bGit] Payment Sent! ID: ${result.transactionId}`);
        if (note) console.log(`[bGit] Timestamp: ${note}`);
    } catch (error) {
        console.error('[bGit] Payment Failed:', error.message);
    }
}

module.exports = { pay };
