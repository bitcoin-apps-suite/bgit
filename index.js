#!/usr/bin/env node

const { Command } = require('commander');
const { spawn } = require('child_process');
const { pay } = require('./handcash');
const program = new Command();

program
    .name('bgit')
    .description('Bitcoin-enabled Git wrapper')
    .version('1.0.0')
    .argument('[args...]', 'Git arguments')
    .allowUnknownOption()
    .action(async (args) => {
        const gitCommand = args[0];
        const needsPayment = ['commit', 'push'].includes(gitCommand);

        if (needsPayment) {
            // Logic for 'push' - Pay before pushing (Gatekeeper)
            if (gitCommand === 'push') {
                console.log(`💰 bgit: "${gitCommand}" requires a micro-payment.`);
                try {
                    // In the future, we could look up the local commit hash to attach here too
                    await pay(0.0001, "Pushing code...");
                    console.log('✅ Payment successful! Executing git command...');
                } catch (error) {
                    console.error('❌ Payment failed:', error.message);
                    process.exit(1);
                }

                const gitProcess = spawn('git', process.argv.slice(2), { stdio: 'inherit' });
                gitProcess.on('close', (code) => { process.exit(code); });
                return;
            }

            // Logic for 'commit' - Commit FIRST, then timestamp hash
            if (gitCommand === 'commit') {
                // 1. Run git commit first
                const gitProcess = spawn('git', process.argv.slice(2), { stdio: 'inherit' });

                gitProcess.on('close', async (code) => {
                    if (code !== 0) process.exit(code);

                    // 2. If successful, get the new HEAD hash
                    const { execSync } = require('child_process');
                    const commitHash = execSync('git rev-parse HEAD').toString().trim();

                    console.log(`\n🔗 Capturing commit hash: ${commitHash}`);
                    console.log(`💰 bgit: Timestamping this commit on-chain...`);

                    try {
                        await pay(0.0001, `Commit: ${commitHash}`);
                        console.log('✅ Commit timestamped on BitcoinSV!');
                        process.exit(0);
                    } catch (error) {
                        console.error('⚠️ Commit succeeded, but on-chain timestamp failed:', error.message);
                        process.exit(0); // Exit 0 because the git commit itself worked
                    }
                });
                return;
            }
        }
    });

program.parse(process.argv);
