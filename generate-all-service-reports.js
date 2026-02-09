import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

console.log('🚀 Generating Reports for ALL Services...\n');

const reportsDir = 'reports';

// Get all unique service names from metrics files
const files = fs.readdirSync(reportsDir)
    .filter(file => file.endsWith('_endpoint_metrics_table.json'));

// Extract service names
const services = [...new Set(files.map(file => {
    const serviceName = file.replace('_endpoint_metrics_table.json', '');
    return serviceName;
}))];

if (services.length === 0) {
    console.error('❌ No metrics files found in reports directory');
    process.exit(1);
}

console.log(`📊 Found ${services.length} services to generate reports for:`);
services.forEach((service, index) => {
    console.log(`  ${index + 1}. ${service}`);
});
console.log('\n');

// Generate a single report for each service
let completedCount = 0;
let failedCount = 0;

services.forEach((serviceName, index) => {
    setTimeout(() => {
        console.log(`⏳ [${index + 1}/${services.length}] Generating report for: ${serviceName}`);
        
        const child = spawn('node', ['generate-full-interactive-report.js'], {
            cwd: process.cwd(),
            env: { ...process.env, FORCE_SERVICE: serviceName }
        });

        let output = '';
        let errorOutput = '';

        child.stdout.on('data', (data) => {
            output += data.toString();
        });

        child.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        child.on('close', (code) => {
            if (code === 0) {
                completedCount++;
                console.log(`✅ Successfully generated: ${serviceName}\n`);
            } else {
                failedCount++;
                console.log(`❌ Failed to generate: ${serviceName}`);
                console.log(`   Error: ${errorOutput}\n`);
            }

            if (completedCount + failedCount === services.length) {
                printSummary();
            }
        });
    }, index * 1000); // Stagger execution by 1 second
});

function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 REPORT GENERATION SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Successful: ${completedCount}/${services.length}`);
    if (failedCount > 0) {
        console.log(`❌ Failed: ${failedCount}/${services.length}`);
    }
    console.log('='.repeat(60));
    console.log('\n📂 Generated files (in html-reports/ folder):');
    
    const timestamp = new Date().toISOString().split('T')[0];
    services.forEach((service) => {
        const filename = `${service}-report-${timestamp}.html`;
        console.log(`   • html-reports/${filename}`);
    });
    
    console.log('\n💡 Next steps:');
    console.log('   1. Create a gh-pages branch');
    console.log('   2. Add entire html-reports folder');
    console.log('   3. Push to gh-pages branch');
    console.log('   4. Enable GitHub Pages in repo settings');
    console.log('\n🔗 Access format: https://username.github.io/repo-name/html-reports/{service-name}-report-{date}.html\n');
}
