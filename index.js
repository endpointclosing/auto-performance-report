#!/usr/bin/env node

/**
 * Main entry point for Auto Performance Report
 * This script provides convenient access to all tools from the root directory
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Get command line arguments
const args = process.argv.slice(2);
const command = args[0];

// Define available commands and their paths
const commands = {
    'fetch': 'src/fetchers/fetchdatadogmetrics.js',
    'fetch-container': 'src/fetchers/fetch-container-metrics.js', 
    'fetch-errors': 'src/fetchers/fetch-error-metrics.js',
    'generate-html': 'src/generators/generate-full-interactive-report.js',
    'confluence': 'src/generators/confluence-uploader.js',
    'auto-report': 'src/core/auto-report.js',
    'slack': 'src/utils/slack-poster.js',
    'deploy': 'src/utils/deploy-to-main.js'
};

function showHelp() {
    console.log(`
📊 Auto Performance Report Tool

Usage: node index.js <command> [options]

Available commands:
  fetch              Fetch Datadog metrics data
  fetch-container    Fetch container/pod metrics  
  fetch-errors       Fetch error metrics
  generate-html      Generate interactive HTML report
  confluence         Generate and upload Confluence report
  auto-report        Run complete automated report process
  slack              Post report to Slack
  deploy             Deploy to main environment

Examples:
  node index.js fetch --service "operator-agent-service" --from "Feb 9, 11:18 am" --to "Feb 9, 12:19 pm"
  node index.js confluence
  node index.js auto-report --service "my-service" --from "Jan 9, 1:53 pm" --to "Jan 9, 2:24 pm"
`);
}

// Show help if no command or help requested
if (!command || command === 'help' || command === '-h' || command === '--help') {
    showHelp();
    process.exit(0);
}

// Check if command exists
if (!commands[command]) {
    console.error(`❌ Unknown command: ${command}`);
    console.log('💡 Run "node index.js help" to see available commands');
    process.exit(1);
}

// Execute the command
const scriptPath = path.join(__dirname, commands[command]);
const childArgs = args.slice(1); // Remove the command from args

console.log(`🚀 Running: ${command}`);
const child = spawn('node', [scriptPath, ...childArgs], {
    stdio: 'inherit',
    cwd: __dirname
});

child.on('close', (code) => {
    process.exit(code);
});