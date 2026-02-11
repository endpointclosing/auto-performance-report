import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import ConfluenceReportGenerator from '../scripts/confluenceReportGenerator.js';

// Load environment variables
dotenv.config();

/**
 * Get dashboard URL for a service
 */
function getDashboardUrl(serviceName, timeRange = null) {
    let baseUrl;

    if (serviceName === 'operator-agent-service' || serviceName === 'order-service') {
        baseUrl = `https://endpointclosing.datadoghq.com/dashboard/6w9-8tv-qj4?fromUser=false&graphType=service_map&historicalData=true&index=&refresh_mode=paused&shouldShowLegend=true&spanViewType=errors&tpl_var_apm-service%5B0%5D=${serviceName}&tpl_var_env%5B0%5D=staging&tpl_var_service%5B0%5D=${serviceName}&traceQuery=`;
    } else {
        baseUrl = `https://endpointclosing.datadoghq.com/dashboard/9tc-enb-57g?fromUser=false&graphType=service_map&historicalData=true&index=&refresh_mode=paused&shouldShowLegend=true&spanViewType=errors&tpl_var_apm-service%5B0%5D=${serviceName}&tpl_var_env%5B0%5D=staging&tpl_var_service%5B0%5D=${serviceName}&traceQuery=`;
    }

    // Add time range parameters if provided
    if (timeRange && timeRange.from && timeRange.to) {
        const fromTs = new Date(timeRange.from).getTime();
        const toTs = new Date(timeRange.to).getTime();

        // Add time range parameters to URL
        return `${baseUrl}&from_ts=${fromTs}&to_ts=${toTs}&live=false`;
    }

    return baseUrl;
}

console.log('🚀 Universal Confluence Report Uploader\n');

// Parse command line arguments
const args = process.argv.slice(2);
let inputFile = null;
let customTitle = null;

// Check for command line arguments
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) {
        inputFile = args[i + 1];
        i++;
    } else if (args[i] === '--title' && args[i + 1]) {
        customTitle = args[i + 1];
        i++;
    } else if (args[i] === '--help') {
        console.log(`Usage: node confluence-uploader.js [options]
        
Options:
  --input <file>    Specify input JSON file (optional - will auto-detect latest)
  --title <title>   Custom report title (optional - will auto-generate)
  --help           Show this help message

Examples:
  node confluence-uploader.js
  node confluence-uploader.js --input "reports/stardust-task-service_endpoint_metrics_table.json"
  node confluence-uploader.js --title "Custom Performance Report"
`);
        process.exit(0);
    }
}

async function uploadReport() {
    try {
        // Auto-detect latest metrics file if not specified
        if (!inputFile) {
            console.log('🔍 Auto-detecting latest metrics file...');
            const reportsDir = 'reports';
            const files = fs.readdirSync(reportsDir)
                .filter(file => file.endsWith('_endpoint_metrics_table.json'))
                .map(file => ({
                    name: file,
                    path: path.join(reportsDir, file),
                    stats: fs.statSync(path.join(reportsDir, file))
                }))
                .sort((a, b) => b.stats.mtime - a.stats.mtime);

            if (files.length === 0) {
                throw new Error('No metrics files found in reports directory');
            }

            inputFile = files[0].path;
            console.log(`✅ Found latest file: ${files[0].name}`);
        }

        // Load the metrics data
        console.log('📊 Loading metrics data...');
        if (!fs.existsSync(inputFile)) {
            throw new Error(`Input file not found: ${inputFile}`);
        }

        const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

        // Load MCP tools data if available (for operator-agent-service)
        let mcpToolsData = null;
        if (data.service === 'operator-agent-service') {
            const mcpToolsFile = `./reports/${data.service}_mcp_tools.json`;
            if (fs.existsSync(mcpToolsFile)) {
                console.log('🔧 Loading MCP tools data...');
                mcpToolsData = JSON.parse(fs.readFileSync(mcpToolsFile, 'utf8'));
                console.log(`✅ Loaded MCP tools data: ${mcpToolsData.totalSlowTools} slow tools found`);
            } else {
                console.log('ℹ️ No MCP tools data found');
            }
        }

        // Add MCP tools data to main data object
        if (mcpToolsData) {
            data.mcpToolsData = mcpToolsData;
        }

        // Add load pattern configuration from environment variables
        data.loadPattern = {
            step1: { rate: process.env.LOAD_STEP_1_RATE || '1', duration: process.env.LOAD_STEP_1_DURATION || '6' },
            step2: { rate: process.env.LOAD_STEP_2_RATE || '2', duration: process.env.LOAD_STEP_2_DURATION || '6' },
            step3: { rate: process.env.LOAD_STEP_3_RATE || '5', duration: process.env.LOAD_STEP_3_DURATION || '6' }
        };

        console.log(`✅ Loaded data for service: ${data.service}`);
        console.log(`📅 Time range: ${data.timeRange.from} to ${data.timeRange.to}`);

        // Try to load corresponding error metrics file
        let errorMetrics = null;
        const errorMetricsFile = inputFile.replace('_endpoint_metrics_table.json', '_error_metrics.json');
        if (fs.existsSync(errorMetricsFile)) {
            console.log('📊 Loading error metrics data...');
            errorMetrics = JSON.parse(fs.readFileSync(errorMetricsFile, 'utf8'));
            data.errorMetrics = errorMetrics;
            console.log(`✅ Loaded error metrics: ${errorMetrics.logSummary.totalLogErrors} log errors, ${errorMetrics.oomSummary.totalOOMEvents} OOM events`);
        } else {
            console.log('ℹ️  No error metrics file found - skipping error analysis');
        }

        // Try to load corresponding container metrics file
        let containerMetrics = null;
        const containerMetricsFile = inputFile.replace('_endpoint_metrics_table.json', '_container_metrics.json');
        if (fs.existsSync(containerMetricsFile)) {
            console.log('📊 Loading container metrics data...');
            containerMetrics = JSON.parse(fs.readFileSync(containerMetricsFile, 'utf8'));
            data.podMetrics = containerMetrics;
            console.log(`✅ Loaded container metrics for ${containerMetrics.summary.totalPods} pods`);
        } else {
            console.log('ℹ️  No container metrics file found - skipping resource analysis');
        }

        // Generate title if not provided
        if (!customTitle) {
            // Convert service name to title case
            const serviceName = data.service
                .split('-')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');

            // Add date and time suffix to ensure uniqueness - each report preserved separately
            const testDateTime = new Date(data.timeRange.from);
            const dateString = testDateTime.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            const timeString = testDateTime.toLocaleTimeString('en-US', {
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
            customTitle = `${serviceName} Performance Report - ${dateString} ${timeString}`;
        }

        console.log(`📋 Report title: ${customTitle}`);

        // Get dashboard URL for the service
        const dashboardUrl = getDashboardUrl(data.service, data.timeRange);
        console.log(`🔗 Dashboard URL: ${dashboardUrl}`);

        // Create generator
        console.log('🔧 Initializing Confluence generator...');
        const generator = new ConfluenceReportGenerator();

        // Generate report content
        console.log('📝 Generating report content...');
        const content = generator.generateStorageFormat(data, 'detailed', customTitle, errorMetrics, containerMetrics, dashboardUrl);
        console.log('✅ Report content generated successfully');

        // Upload to Confluence
        console.log('🌐 Uploading to Confluence...');
        await generator.uploadToConfluence(content, customTitle);

        // Generate and upload interactive HTML report as attachment
        console.log('📎 Generating interactive HTML report...');
        try {
            execSync('node src/generators/generate-full-interactive-report.js', { stdio: 'inherit' });
        } catch (error) {
            console.warn('⚠️  Could not generate interactive HTML report');
        }

        // Create a copy of the service-specific report as "complete-interactive-report.html" for download
        const serviceName = data.service || 'report';
        const timestamp = new Date().toISOString().split('T')[0];
        const serviceSpecificPath = `./html-reports/${serviceName}-report-${timestamp}.html`;
        const genericPath = './complete-interactive-report.html';

        if (fs.existsSync(serviceSpecificPath)) {
            // Copy service-specific file to generic name for Confluence download
            fs.copyFileSync(serviceSpecificPath, genericPath);
            console.log(`📎 Uploading interactive HTML report as attachment: complete-interactive-report.html`);
            await generator.uploadAttachment(customTitle, genericPath, 'Interactive Performance Report with full Chart.js visualizations');
            console.log('✅ Interactive report attached successfully');
        } else {
            console.log(`⚠️  Interactive HTML report not found at: ${serviceSpecificPath}`);
        }

        console.log('\n🎉 Report uploaded successfully to Confluence!');
        console.log('🔗 Check your Confluence space for the report.');

    } catch (error) {
        console.error('❌ Error uploading report:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

uploadReport();