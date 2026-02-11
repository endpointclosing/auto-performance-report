import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config();

/**
 * Slack Integration for Performance Reports
 * Posts performance reports to designated Slack channels on regular cadence
 * Surfaces critical issues as call-to-action messages
 */

class SlackPoster {
    constructor() {
        this.webhookUrl = process.env.SLACK_WEBHOOK_URL;
        this.defaultChannel = process.env.SLACK_DEFAULT_CHANNEL || '#performance-alerts';
        this.channelMappings = this.loadChannelMappings();

        if (!this.webhookUrl) {
            throw new Error('SLACK_WEBHOOK_URL environment variable is required');
        }
    }

    /**
     * Load service-to-channel mappings from environment
     */
    loadChannelMappings() {
        const mappings = {};

        // Load from environment variables like SLACK_OPERATOR_AGENT_CHANNEL
        for (const [key, value] of Object.entries(process.env)) {
            if (key.startsWith('SLACK_') && key.endsWith('_CHANNEL')) {
                const serviceName = key
                    .replace('SLACK_', '')
                    .replace('_CHANNEL', '')
                    .toLowerCase()
                    .replace(/_/g, '-');
                mappings[serviceName] = value;
            }
        }

        return mappings;
    }

    /**
     * Analyze report content to determine severity and extract key issues
     */
    analyzeReportSeverity(reportContent) {
        const criticalKeywords = [
            'error', 'failed', 'critical', 'down', 'outage', 'timeout',
            'high latency', 'restart', 'spike', 'exceed', 'unavailable'
        ];

        const warningKeywords = [
            'warning', 'slow', 'degraded', 'increased', 'anomaly', 'investigate'
        ];

        const lowerContent = reportContent.toLowerCase();

        let severity = 'info';
        let issues = [];

        // Check for critical issues
        for (const keyword of criticalKeywords) {
            if (lowerContent.includes(keyword)) {
                severity = 'critical';
                issues.push(keyword);
            }
        }

        // Check for warnings if not already critical
        if (severity !== 'critical') {
            for (const keyword of warningKeywords) {
                if (lowerContent.includes(keyword)) {
                    severity = 'warning';
                    issues.push(keyword);
                }
            }
        }

        // Extract key findings from observations section
        const observationsMatch = reportContent.match(/📊 Key Findings:(.*?)(?=💡 Recommendations:|$)/s);
        let keyFindings = [];

        if (observationsMatch) {
            const findingsText = observationsMatch[1];
            const findings = findingsText.match(/<li[^>]*>(.*?)<\/li>/g);
            if (findings) {
                keyFindings = findings.map(f =>
                    f.replace(/<[^>]*>/g, '').trim()
                ).filter(f => f.length > 0).slice(0, 3); // Top 3 findings
            }
        }

        return { severity, issues: [...new Set(issues)], keyFindings };
    }

    /**
     * Format Slack message based on severity and findings
     */
    formatSlackMessage(serviceName, analysis, reportUrl, browserUrl, timeRange) {
        const { severity, issues, keyFindings } = analysis;

        let emoji, color, urgency;

        switch (severity) {
            case 'critical':
                emoji = '🚨';
                color = 'danger';
                urgency = '*URGENT ACTION REQUIRED*';
                break;
            case 'warning':
                emoji = '⚠️';
                color = 'warning';
                urgency = '*Requires Attention*';
                break;
            default:
                emoji = '✅';
                color = 'good';
                urgency = 'Status: All Clear';
        }

        const serviceFriendlyName = serviceName
            .split('-')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        let message = {
            text: `${emoji} Performance Report: ${serviceFriendlyName}`,
            attachments: [{
                color: color,
                title: `${serviceFriendlyName} Performance Report`,
                title_link: browserUrl,
                fields: [
                    {
                        title: "Status",
                        value: urgency,
                        short: true
                    },
                    {
                        title: "Time Range",
                        value: timeRange,
                        short: true
                    }
                ],
                footer: "Performance Monitoring",
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        // Add key findings if available
        if (keyFindings.length > 0) {
            const findingsText = keyFindings
                .map(finding => `• ${finding}`)
                .join('\n');

            message.attachments[0].fields.push({
                title: "Key Findings",
                value: findingsText,
                short: false
            });
        }

        // Add action buttons
        message.attachments[0].actions = [
            {
                type: "button",
                text: "🌐 View Interactive Report",
                url: browserUrl,
                style: severity === 'critical' ? 'danger' : 'primary'
            },
            {
                type: "button",
                text: "📥 Download Report",
                url: reportUrl
            }
        ];

        // Add urgent call-to-action for critical issues
        if (severity === 'critical') {
            message.attachments.unshift({
                color: 'danger',
                title: '🚨 IMMEDIATE ATTENTION REQUIRED',
                text: `Critical performance issues detected in ${serviceFriendlyName}. Please investigate immediately.`,
                mrkdwn_in: ['text']
            });
        }

        return message;
    }

    /**
     * Post message to Slack webhook
     */
    async postToSlack(message, channel = null) {
        if (channel) {
            message.channel = channel;
        }

        const data = JSON.stringify(message);

        return new Promise((resolve, reject) => {
            const url = new URL(this.webhookUrl);

            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';

                res.on('data', (chunk) => {
                    responseData += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve({ success: true, response: responseData });
                    } else {
                        reject(new Error(`Slack API returned ${res.statusCode}: ${responseData}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

    /**
     * Get appropriate channel for service
     */
    getChannelForService(serviceName) {
        return this.channelMappings[serviceName] || this.defaultChannel;
    }

    /**
     * Main method to post performance report
     */
    async postPerformanceReport(serviceName, timeRange = 'Last 24 hours') {
        try {
            console.log(`📢 Posting ${serviceName} performance report to Slack...`);

            // Look for the latest generated report
            const reportsDir = path.join(__dirname, 'html-reports');
            const reportFiles = fs.readdirSync(reportsDir)
                .filter(file => file.includes(serviceName) && file.endsWith('.html'))
                .sort((a, b) => {
                    const aTime = fs.statSync(path.join(reportsDir, a)).mtime;
                    const bTime = fs.statSync(path.join(reportsDir, b)).mtime;
                    return bTime - aTime;
                });

            if (reportFiles.length === 0) {
                throw new Error(`No report files found for service: ${serviceName}`);
            }

            const latestReport = reportFiles[0];
            const reportPath = path.join(reportsDir, latestReport);
            const reportContent = fs.readFileSync(reportPath, 'utf8');

            // Generate URLs
            const githubPagesBase = process.env.GITHUB_PAGES_BASE_URL;
            if (!githubPagesBase) {
                throw new Error('GITHUB_PAGES_BASE_URL environment variable is required');
            }

            const reportUrl = `${githubPagesBase}/html-reports/${latestReport}`;
            const browserUrl = `${githubPagesBase}/html-reports/${latestReport}`;

            // Analyze report content
            const analysis = this.analyzeReportSeverity(reportContent);

            // Format message
            const message = this.formatSlackMessage(
                serviceName,
                analysis,
                reportUrl,
                browserUrl,
                timeRange
            );

            // Get appropriate channel
            const channel = this.getChannelForService(serviceName);

            // Post to Slack
            const result = await this.postToSlack(message, channel);

            console.log(`✅ Successfully posted report to ${channel}`);
            console.log(`📊 Severity: ${analysis.severity}`);

            if (analysis.issues.length > 0) {
                console.log(`⚠️  Issues detected: ${analysis.issues.join(', ')}`);
            }

            return {
                success: true,
                channel,
                severity: analysis.severity,
                issues: analysis.issues,
                reportUrl,
                browserUrl
            };

        } catch (error) {
            console.error('❌ Failed to post to Slack:', error.message);
            throw error;
        }
    }
}

// CLI Support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    let serviceName = null;
    let timeRange = 'Last 24 hours';

    // Parse command line arguments
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--service' && i + 1 < args.length) {
            serviceName = args[i + 1];
            i++;
        } else if (args[i] === '--time-range' && i + 1 < args.length) {
            timeRange = args[i + 1];
            i++;
        } else if (args[i].startsWith('--service=')) {
            serviceName = args[i].split('=')[1];
        } else if (args[i].startsWith('--time-range=')) {
            timeRange = args[i].split('=')[1];
        }
    }

    if (!serviceName) {
        console.error('❌ Service name is required');
        console.log('Usage: node slack-poster.js --service <service-name> [--time-range "Last 24 hours"]');
        console.log('Example: node slack-poster.js --service operator-agent-service --time-range "Last 4 hours"');
        process.exit(1);
    }

    // Post report
    const poster = new SlackPoster();
    poster.postPerformanceReport(serviceName, timeRange)
        .then(result => {
            console.log('🚀 Slack posting completed successfully!');
            if (result.severity === 'critical') {
                console.log('🚨 Critical issues detected - team has been alerted!');
            }
        })
        .catch(error => {
            console.error('💥 Slack posting failed:', error.message);
            process.exit(1);
        });
}

export default SlackPoster;