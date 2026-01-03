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
            console.log(`💰 bgit: "${gitCommand}" requires a micro-payment.`);
            try {
                await pay(0.0001); // Mock payment amount
                console.log('✅ Payment successful! Executing git command...');
            } catch (error) {
                console.error('❌ Payment failed:', error.message);
                process.exit(1);
            }
        }

        // Pass all arguments directly to real git
        const gitProcess = spawn('git', process.argv.slice(2), { stdio: 'inherit' });

        gitProcess.on('close', (code) => {
            process.exit(code);
        });
    });

program.parse(process.argv);
