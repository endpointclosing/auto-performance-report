import { execSync } from 'child_process';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('🚀 Deploying Reports to Main Branch\n');

function runCommand(command, description) {
    try {
        console.log(`⏳ ${description}...`);
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ ${description} - Done\n`);
        return true;
    } catch (error) {
        console.error(`❌ ${description} - Failed`);
        return false;
    }
}

async function deploy() {
    // Check if html-reports folder exists and has files
    if (!fs.existsSync('./html-reports')) {
        console.error('❌ html-reports folder not found!');
        console.log('💡 Run: node generate-full-interactive-report.js first\n');
        process.exit(1);
    }
    
    const reportFiles = fs.readdirSync('./html-reports').filter(f => f.endsWith('.html'));
    if (reportFiles.length === 0) {
        console.error('❌ No HTML reports found in html-reports folder!');
        console.log('💡 Run: node generate-full-interactive-report.js first\n');
        process.exit(1);
    }
    
    console.log(`📊 Found ${reportFiles.length} report(s) to deploy:`);
    reportFiles.forEach(file => console.log(`   • ${file}`));
    console.log('\n');
    
    // Add html-reports folder to git
    console.log('💾 Adding html-reports to main branch...\n');
    runCommand('git add -f html-reports/', 'Adding html-reports folder');
    
    const date = new Date().toISOString().split('T')[0];
    const commitMessage = `Update service reports - ${date}`;
    
    if (!runCommand(`git commit -m "${commitMessage}"`, 'Commit changes')) {
        console.log('⚠️  No changes to commit (reports may be up to date)\n');
    }
    
    // Push to main branch
    console.log('🚀 Pushing to main branch...\n');
    if (!runCommand('git push origin main', 'Push to GitHub')) {
        process.exit(1);
    }
    
    // Show URLs
    const githubBaseUrl = process.env.GITHUB_PAGES_BASE_URL || 'https://stunning-barnacle-wre1op1.pages.github.io';
    const baseUrl = `${githubBaseUrl}/html-reports/`;
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ DEPLOYMENT SUCCESSFUL!');
    console.log('='.repeat(70));
    console.log(`\n📊 Deployed ${reportFiles.length} report(s) to main branch\n`);
    console.log('🔗 Your reports are available at:\n');
    reportFiles.forEach(file => {
        console.log(`   ${baseUrl}${file}`);
    });
    console.log('\n⏰ Note: GitHub Pages may take 1-2 minutes to update.\n');
    console.log('💡 Reports are now hosted directly from main branch!\n');
    console.log('='.repeat(70));
}

deploy().catch(error => {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
});