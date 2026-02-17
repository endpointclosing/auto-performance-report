import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('🚀 Deploying Reports to Main Branch\n');

function cleanGitLocks() {
    const locks = [
        '.git/index.lock',
        '.git/COMMIT_EDITMSG.lock',
        '.git/HEAD.lock'
    ];
    
    locks.forEach(lockFile => {
        try {
            if (fs.existsSync(lockFile)) {
                fs.unlinkSync(lockFile);
                console.log(`🧹 Removed ${lockFile}`);
            }
        } catch (error) {
            // Silently ignore - file might be in use
        }
    });
}

function runCommand(command, description, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            if (attempt > 1) {
                console.log(`   🔄 Retry ${attempt}/${retries}...`);
                // Clean locks before retry
                cleanGitLocks();
                // Wait a bit before retry
                execSync('timeout /t 2 /nobreak', { stdio: 'ignore' });
            } else {
                console.log(`⏳ ${description}...`);
            }
            
            execSync(command, { stdio: 'inherit' });
            console.log(`✅ ${description} - Done\n`);
            return true;
        } catch (error) {
            if (attempt === retries) {
                console.error(`❌ ${description} - Failed after ${retries} attempts`);
                return false;
            }
        }
    }
    return false;
}

async function deploy() {
    // Clean any existing Git locks first
    console.log('🧹 Cleaning Git locks...\n');
    cleanGitLocks();
    
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

    // Reset Git index first to avoid stale state
    console.log('🔄 Resetting Git index...\n');
    runCommand('git reset', 'Reset Git index', 1);

    // Add html-reports folder to git
    console.log('💾 Adding html-reports to main branch...\n');
    if (!runCommand('git add -f html-reports/', 'Adding html-reports folder', 3)) {
        console.error('❌ Failed to add files. Skipping deployment.');
        process.exit(1);
    }

    const date = new Date().toISOString().split('T')[0];
    const commitMessage = `Update service reports - ${date}`;

    if (!runCommand(`git commit -m "${commitMessage}"`, 'Commit changes', 3)) {
        console.log('⚠️  No changes to commit (reports may be up to date)\n');
    }

    // Push to main branch
    console.log('🚀 Pushing to main branch...\n');
    if (!runCommand('git push origin main', 'Push to GitHub', 3)) {
        console.error('❌ Failed to push to GitHub');
        console.log('💡 Check your GitHub credentials and network connection');
        process.exit(1);
    }

    // Show URLs
    const githubBaseUrl = process.env.GITHUB_PAGES_BASE_URL || 'https://endpointclosing.github.io';
    const githubRepoName = process.env.GITHUB_REPO_NAME || 'auto-performance-report';
    const baseUrl = `${githubBaseUrl}/${githubRepoName}/html-reports/`;

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