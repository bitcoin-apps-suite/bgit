// This is a placeholder for the actual HandCash SDK integration.
// For Phase 1 validation, we are mocking the payment flow.

async function pay(amount, note = '') {
    return new Promise((resolve, reject) => {
        console.log(`Connecting to HandCash...`);
        if (note) console.log(`📝 Attaching note: "${note}"`);

        // Simulate network delay
        setTimeout(() => {
            // 90% chance of success for testing
            const success = true;

            if (success) {
                console.log(`💸 Sent $${amount} via HandCash.`);
                resolve({ txId: 'mock_tx_id_' + Date.now() });
            } else {
                reject(new Error('Insufficient funds or user cancelled.'));
            }
        }, 1500);
    });
}

module.exports = { pay };
