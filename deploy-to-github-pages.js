import { execSync } from 'child_process';
import fs from 'fs';

console.log('🚀 Deploying Reports to GitHub Pages\n');

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

function getCurrentBranch() {
    try {
        return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch (error) {
        return 'unknown';
    }
}

async function deploy() {
    const currentBranch = getCurrentBranch();
    console.log(`📍 Current branch: ${currentBranch}\n`);
    
    // Check if html-reports folder exists and has files
    if (!fs.existsSync('./html-reports')) {
        console.error('❌ html-reports folder not found!');
        console.log('💡 Run: node generate-all-service-reports.js first\n');
        process.exit(1);
    }
    
    const reportFiles = fs.readdirSync('./html-reports').filter(f => f.endsWith('.html'));
    if (reportFiles.length === 0) {
        console.error('❌ No HTML reports found in html-reports folder!');
        console.log('💡 Run: node generate-all-service-reports.js first\n');
        process.exit(1);
    }
    
    console.log(`📊 Found ${reportFiles.length} report(s) to deploy:`);
    reportFiles.forEach(file => console.log(`   • ${file}`));
    console.log('\n');
    
    // Save current changes
    console.log('💾 Saving current work...\n');
    runCommand('git add html-reports/', 'Adding html-reports folder');
    
    // Check if gh-pages branch exists
    let ghPagesExists = false;
    try {
        execSync('git rev-parse --verify gh-pages', { stdio: 'ignore' });
        ghPagesExists = true;
    } catch (error) {
        ghPagesExists = false;
    }
    
    if (!ghPagesExists) {
        console.log('📝 Creating gh-pages branch...\n');
        if (!runCommand('git checkout --orphan gh-pages', 'Create gh-pages branch')) {
            process.exit(1);
        }
        if (!runCommand('git rm -rf .', 'Clean gh-pages branch')) {
            process.exit(1);
        }
    } else {
        console.log('📝 Switching to gh-pages branch...\n');
        if (!runCommand('git checkout gh-pages', 'Switch to gh-pages')) {
            process.exit(1);
        }
    }
    
    // Copy html-reports from main/master branch
    console.log('📂 Copying html-reports folder from main branch...\n');
    const mainBranch = currentBranch === 'gh-pages' ? 'main' : currentBranch;
    
    if (!runCommand(`git checkout ${mainBranch} -- html-reports/`, 'Copy html-reports folder')) {
        // Try master if main doesn't work
        if (!runCommand('git checkout master -- html-reports/', 'Copy html-reports folder from master')) {
            console.error('❌ Could not copy html-reports from main or master branch');
            process.exit(1);
        }
    }
    
    // Add and commit
    console.log('💾 Committing changes...\n');
    runCommand('git add html-reports/', 'Stage html-reports folder');
    
    const date = new Date().toISOString().split('T')[0];
    const commitMessage = `Deploy service reports - ${date}`;
    
    if (!runCommand(`git commit -m "${commitMessage}"`, 'Commit changes')) {
        console.log('⚠️  No changes to commit (reports may be up to date)\n');
    }
    
    // Push to gh-pages
    console.log('🚀 Pushing to gh-pages branch...\n');
    if (!runCommand('git push origin gh-pages', 'Push to GitHub')) {
        process.exit(1);
    }
    
    // Switch back to original branch
    console.log(`🔙 Switching back to ${mainBranch} branch...\n`);
    runCommand(`git checkout ${mainBranch}`, `Switch back to ${mainBranch}`);
    
    // Load config for URLs
    let baseUrl = 'https://username.github.io/repo-name/html-reports/';
    if (fs.existsSync('.github-pages-config.json')) {
        const config = JSON.parse(fs.readFileSync('.github-pages-config.json', 'utf8'));
        baseUrl = config.baseUrl;
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ DEPLOYMENT SUCCESSFUL!');
    console.log('='.repeat(70));
    console.log(`\n📊 Deployed ${reportFiles.length} report(s) to GitHub Pages\n`);
    console.log('🔗 Your reports are available at:\n');
    reportFiles.forEach(file => {
        console.log(`   ${baseUrl}${file}`);
    });
    console.log('\n⏰ Note: GitHub Pages may take 1-2 minutes to update.\n');
    console.log('💡 You can now share these links in your Confluence report!\n');
    console.log('='.repeat(70));
}

deploy().catch(error => {
    console.error('\n❌ Deployment failed:', error.message);
    process.exit(1);
});
