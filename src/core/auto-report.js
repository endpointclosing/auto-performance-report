import { execSync } from 'child_process';

console.log('🚀 AUTO PERFORMANCE REPORT - COMPLETE AUTOMATION');

// Parse command line arguments
const args = process.argv.slice(2);
let fromTime = null;
let toTime = null;
let serviceName = null;

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
        fromTime = args[i + 1];
        i++;
    } else if (args[i] === '--to' && args[i + 1]) {
        toTime = args[i + 1];
        i++;
    } else if (args[i] === '--service' && args[i + 1]) {
        serviceName = args[i + 1];
        i++;
    } else if (args[i] === '--help') {
        console.log(`Usage: node auto-report.js --from 'time' --to 'time' --service 'service-name'

Examples:
  node auto-report.js --from 'Jan 14, 1:51 pm' --to 'Jan 14, 2:21 pm' --service 'stardust-communication-service'
  node auto-report.js --from 'Feb 3, 12:33 am' --to 'Feb 3, 12:36 am' --service 'stardust-activity-log-service'
`);
        process.exit(0);
    }
}

if (!fromTime || !toTime || !serviceName) {
    console.error('❌ Missing required parameters!');
    console.log('Usage: node auto-report.js --from \'time\' --to \'time\' --service \'service-name\'');
    console.log('Use --help for more examples');
    process.exit(1);
}

console.log('🎯 Parameters:');
console.log(`   📅 Time Range: ${fromTime} → ${toTime}`);
console.log(`   🏷️  Service: ${serviceName}`);
console.log('='.repeat(70));

function runCommand(command, description) {
    try {
        console.log(`\n${description}`);
        console.log('⏳ ' + description.split(' ')[0] + '...');
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ ${description.split(' ')[0]} - Done`);
        return true;
    } catch (error) {
        console.error(`❌ ${description.split(' ')[0]} - Failed:`, error.message);
        return false;
    }
}

async function runAutomation() {
    console.log('🎯 AUTOMATED REPORT GENERATION');
    console.log('='.repeat(70));

    // Step 1: Fetch Datadog metrics
    const step1 = `node src/fetchers/fetchdatadogmetrics.js --from "${fromTime}" --to "${toTime}" --service "${serviceName}"`;
    if (!runCommand(step1, '1️⃣  FETCHING DATADOG METRICS')) {
        process.exit(1);
    }

    // Step 2: Generate HTML report and upload to Confluence
    const step2 = `node src/generators/confluence-uploader.js`;
    if (!runCommand(step2, '2️⃣  GENERATING HTML REPORT & UPLOADING TO CONFLUENCE')) {
        process.exit(1);
    }

    // Step 3: Deploy to GitHub main branch
    const step3 = `node src/utils/deploy-to-main.js`;
    if (!runCommand(step3, '3️⃣  DEPLOYING TO GITHUB MAIN BRANCH')) {
        process.exit(1);
    }

    console.log('\n' + '='.repeat(70));
    console.log('🎉 AUTOMATION COMPLETE!');
    console.log('='.repeat(70));
    console.log('✅ Successfully completed:');
    console.log('   1. ✅ Fetched metrics from Datadog');
    console.log('   2. ✅ Generated HTML report');
    console.log('   3. ✅ Uploaded to Confluence with download + browser links');
    console.log('   4. ✅ Deployed to GitHub main branch');
    console.log('\n💡 Your report is now available in both Confluence and GitHub Pages!');
    console.log('🔗 Check your Confluence space for the updated report.');
    console.log('='.repeat(70));
}

runAutomation().catch(error => {
    console.error('\n❌ Automation failed:', error.message);
    process.exit(1);
});