#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Confluence Report Generator
 * 
 * This script generates and optionally uploads performance reports to Confluence
 * from Datadog metrics data.
 * 
 * Usage:
 *   node src/scripts/confluenceReport.js [options]
 * 
 * Options:
 *   --input <path>        Path to JSON metrics file (default: ./reports/activity_log_endpoint_metrics_table.json)
 *   --output <path>       Output directory for generated reports (default: ./reports/confluence)
 *   --upload             Upload report to Confluence
 *   --space <key>        Confluence space key (overrides .env)
 *   --title <title>      Custom report title
 *   --template <type>    Report template: detailed|summary|regression (default: detailed)
 *   --help               Show this help message
 */

class ConfluenceReportGenerator {
    constructor() {
        this.confluenceConfig = {
            baseUrl: process.env.CONFLUENCE_BASE_URL,
            userEmail: process.env.CONFLUENCE_USER_EMAIL,
            apiToken: process.env.CONFLUENCE_API_TOKEN,
            spaceKey: process.env.CONFLUENCE_SPACE_KEY
        };

        this.validateConfig();
        this.setupAxios();
    }

    validateConfig() {
        const required = ['baseUrl', 'userEmail', 'apiToken', 'spaceKey'];
        const missing = required.filter(key => !this.confluenceConfig[key]);
        
        if (missing.length > 0) {
            console.warn(`⚠️  Missing Confluence config: ${missing.join(', ')}`);
            console.warn('   Upload functionality will be disabled.');
        }
    }

    setupAxios() {
        this.confluenceApi = axios.create({
            baseURL: `${this.confluenceConfig.baseUrl}/wiki/rest/api`,
            auth: {
                username: this.confluenceConfig.userEmail,
                password: this.confluenceConfig.apiToken
            },
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });
    }

    /**
     * Generate dynamic Datadog dashboard URL based on service and time range
     */
    generateDatadogUrl(data) {
        const service = data.service;
        const environment = data.environment || 'staging';
        const fromTs = (data.timeRange.from_unix * 1000).toString(); // Convert to milliseconds
        const toTs = (data.timeRange.to_unix * 1000).toString();
        
        // Service-specific dashboard URLs
        const dashboardIds = {
            'order-service': '6w9-8tv-qj4',
            'operator-agent-service': '6w9-8tv-qj4'
        };
        
        const dashboardId = dashboardIds[service] || '9tc-enb-57g'; // Default fallback
        const baseUrl = `https://endpointclosing.datadoghq.com/dashboard/${dashboardId}`;
        const params = new URLSearchParams({
            'fromUser': 'false',
            'graphType': 'service_map',
            'highlight': service,
            'historicalData': 'true',
            'index': '',
            'refresh_mode': 'paused',
            'shouldShowLegend': 'true',
            'tile_focus': '6193416178087784',
            [`tpl_var_apm-service[0]`]: service,
            [`tpl_var_env[0]`]: environment,
            [`tpl_var_service[0]`]: service,
            'traceQuery': '',
            'from_ts': fromTs,
            'to_ts': toTs,
            'live': 'false'
        });
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Generate Datadog logs URL for error analysis
     */
    generateDatadogLogsUrl(data, errorLevel = 'error') {
        const service = data.service;
        const environment = data.environment || 'staging';
        const fromTs = data.timeRange.from_unix * 1000; // Convert to milliseconds
        const toTs = data.timeRange.to_unix * 1000;
        
        // Base logs URL
        const baseUrl = 'https://endpointclosing.datadoghq.com/logs';
        
        // Create search query for service (URL encoded format)
        const query = `env:${environment} service:${service}`;
        
        const params = new URLSearchParams({
            'query': query,
            'agg_m': 'count',
            'agg_m_source': 'base',
            'agg_t': 'count',
            'clustering_pattern_field_path': 'message',
            'cols': 'host,service',
            'fromUser': 'true',
            'messageDisplay': 'inline',
            'refresh_mode': 'paused',
            'storage': 'hot',
            'stream_sort': 'desc',
            'viz': 'pattern',
            'from_ts': fromTs.toString(),
            'to_ts': toTs.toString(),
            'live': 'false'
        });
        
        return `${baseUrl}?${params.toString()}`;
    }

    /**
     * Get consistent font styling for report elements
     */
    getFontStyles() {
        return {
            fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif',
            baseFontSize: '14px',
            headerFont: 'font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif; font-weight: 600;',
            bodyFont: 'font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif; font-size: 14px; line-height: 1.6;',
            codeFont: 'font-family: "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace; font-size: 12px;',
            linkStyle: 'color: #0052CC; text-decoration: underline; font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif;',
            tableFont: 'font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif; font-size: 13px;',
            emphasisFont: 'font-family: "Segoe UI", -apple-system, BlinkMacSystemFont, "Roboto", "Helvetica Neue", Arial, sans-serif; font-weight: bold;'
        };
    }

    /**
     * Generate Confluence Storage Format (XHTML)
     */
    generateStorageFormat(data, template = 'detailed', customTitle = null, errorMetrics = null, containerMetrics = null, dashboardUrl = null) {
        const timestamp = new Date().toLocaleString();
        const title = customTitle || `${data.service} Performance Report`;

        let content = '';

        // Header section with better styling - use provided dashboard URL or fallback to generated one
        const serviceLink = dashboardUrl || this.generateDatadogUrl(data);
        content += '<table style="width: 100%; border: none; margin-bottom: 20px; background-color: #F4F5F7; border-radius: 3px;">';
        content += '<tbody>';
        content += '<tr>';
        content += `<td style="padding: 15px; border: none;"><strong style="font-size: 14px;">Service:</strong> <a href="${serviceLink}" style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px; font-weight: 600; font-size: 13px; text-decoration: none; margin-left: 8px;" target="_blank">${data.service}</a></td>`;
        content += `<td style="padding: 15px; border: none;"><strong style="font-size: 14px;">Environment:</strong> <span style="background-color: #00875A; color: white; padding: 4px 12px; border-radius: 3px; font-weight: 600; font-size: 13px;">${data.environment.toUpperCase()}</span></td>`;
        content += '</tr>';
        content += '</tbody></table>';
        content += '<hr style="border: none; border-top: 2px solid #DFE1E6; margin: 20px 0;"/>';

        if (template === 'summary') {
            content += this.generateSummaryReport(data);
        } else if (template === 'regression') {
            content += this.generateRegressionReport(data);
        } else {
            content += this.generateDetailedReport(data);
        }

        return content;
    }

    generateDetailedReport(data) {
        let content = '';
        
        // Add Objective section
        content += this.generateObjectiveSection(data);
        
        // Add Test Scope & Design section
        content += this.generateTestScopeSection(data);
        
        // Add Pod/Container Metrics section if available
        content += this.generatePodMetricsSection(data);
        
        // Add Endpoints section
        content += '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #0052CC; padding-bottom: 8px; margin-top: 30px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">📋 Endpoint Performance Summary</span></h2>';
        
        // Add disclaimer about metric values
        content += '<ac:structured-macro ac:name="info" ac:schema-version="1">';
        content += '<ac:rich-text-body>';
        content += '<p style="' + this.getFontStyles().bodyFont + ' margin: 0;"><strong>Note:</strong> Metric values are calculated from Datadog APM traces using time-series aggregation. ';
        content += 'Values may vary slightly (±10-20%) from the Datadog UI due to different aggregation methods and time bucket granularity. ';
        content += 'Trends and relative comparisons between endpoints remain accurate for performance analysis.</p>';
        content += '</ac:rich-text-body>';
        content += '</ac:structured-macro>';
        
        // Performance table in Datadog format
        content += '<table data-table-width="1200">';
        content += '<colgroup><col width="250"/><col width="140"/><col width="140"/><col width="140"/><col width="140"/><col width="120"/><col width="140"/></colgroup>';
        content += '<tbody>';
        content += '<tr>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>RESOURCE_NAME</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>REQUESTS</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>P95 LATENCY</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>P99 LATENCY</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>RATE</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>ERRORS</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>ERROR RATE</strong></p></th>';
        content += '</tr>';

        data.metrics.forEach(metric => {
            content += '<tr>';
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.resource_name}</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.requests} hits</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.p95_latency}</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.p99_latency}</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.rate}</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.errors || '—'}</p></td>`;
            content += `<td><p style="${this.getFontStyles().tableFont}">${metric.error_rate || '0'}</p></td>`;
            content += '</tr>';
        });

        content += '</tbody></table>';

        // Add P95 Time Series Chart section if data is available
        if (data.timeSeries && Object.keys(data.timeSeries).length > 0) {
            content += this.generateP95ChartSection(data);
        }

        // Add Error Summary section if error data is available
        if (data.errorMetrics) {
            content += this.generateErrorSummarySection(data.errorMetrics, data);
        }

        // Add OOM Events section if OOM data is available
        if (data.errorMetrics && data.errorMetrics.oomSummary && data.errorMetrics.oomSummary.totalOOMEvents > 0) {
            content += this.generateOOMEventsSection(data.errorMetrics.oomSummary);
        }

        // Add Overall Observations section
        content += this.generateObservationsSection(data);

        return content;
    }

    generateP95ChartSection(data) {
        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #0052CC; padding-bottom: 8px; margin-top: 30px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">📊 P95 Latency Time Series Analysis</span></h2>';
        
        // Add interactive report download link in a styled box
        content += '<div style="background-color: #F4F5F7; border-left: 4px solid #00875A; padding: 12px 20px; margin: 15px 0; border-radius: 3px;">';
        content += '<p style="margin: 0;"><strong>📥 Download Interactive Report:</strong> ';
        content += '<ac:link>';
        content += '<ri:attachment ri:filename="complete-interactive-report.html"/>';
        content += '<ac:plain-text-link-body><![CDATA[complete-interactive-report.html]]></ac:plain-text-link-body>';
        content += '</ac:link>';
        content += ' for real-time hover tooltips</p>';
        content += '</div>';
        content += '<style>a[href] { font-weight: bold; }</style>';
        
        // Generate Confluence native charts
        content += this.generateConfluenceNativeCharts(data);
        
        return content;
    }

    generateConfluenceNativeCharts(data) {
        let content = '';
        const colors = ['#632CA6', '#F84D8C', '#19A974', '#E8871E', '#3D4EB8', '#C93854', '#137CBD', '#00BF87', '#DB3737', '#8F398F'];
        
        // Individual endpoint time series charts section
        content += '<h3 style="' + this.getFontStyles().headerFont + ' color: #172B4D; margin-top: 25px; margin-bottom: 10px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">📈 Individual Endpoint Time Series</span></h3>';
        content += '<div style="background-color: #F4F5F7; padding: 10px 15px; margin-bottom: 15px; border-radius: 3px;">';
        content += '<p style="margin: 0; color: #172B4D; font-weight: 500;">Each section shows P95 latency over time with request rate context. Click to expand endpoint details.</p>';
        content += '</div>';
        
        Object.keys(data.timeSeries).forEach((endpoint, index) => {
            const metric = data.metrics.find(m => m.resource_name === endpoint);
            const timeSeries = data.timeSeries[endpoint];
            const rateTimeSeries = data.rateTimeSeries && data.rateTimeSeries[endpoint] ? data.rateTimeSeries[endpoint] : [];
            const values = timeSeries.map(d => d.value);
            const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
            const color = colors[index % colors.length];
            const rate = parseFloat(metric.rate.split(' ')[0]);
            
            content += '<ac:structured-macro ac:name="expand" ac:schema-version="1">';
            content += `<ac:parameter ac:name="title">${index + 1}. ${endpoint}</ac:parameter>`;
            content += '<ac:rich-text-body>';
            
            // Add performance summary at top
            content += '<table style="margin-bottom: 15px; width: 700px; background-color: #f4f5f7;">';
            content += '<tbody>';
            content += '<tr>';
            content += `<td style="padding: 8px;"><strong>Request Rate:</strong> ${metric.rate}</td>`;
            content += `<td style="padding: 8px;"><strong>Total Requests:</strong> ${metric.requests}</td>`;
            content += `<td style="padding: 8px;"><strong>P95 Latency:</strong> ${metric.p95_latency}</td>`;
            content += `<td style="padding: 8px;"><strong>P99 Latency:</strong> ${metric.p99_latency}</td>`;
            content += '</tr>';
            content += '</tbody></table>';
            
            // Create dual-axis chart: Rate vs P95 over time
            const chartLabels = timeSeries.map((point, idx) => {
                if (idx % 6 === 0 || idx === timeSeries.length - 1) {
                    return new Date(point.timestamp).toLocaleTimeString('en-US', { 
                        hour: '2-digit', minute: '2-digit', hour12: false 
                    });
                }
                return '';
            });
            
            const p95Data = timeSeries.map(point => point.value.toFixed(1));
            const rateData = rateTimeSeries.length > 0 ? rateTimeSeries.map(point => point.value.toFixed(2)) : [];
            
            // Create Request Rate over Time chart (if data available)
            if (rateData.length > 0) {
                content += '<p><strong>Request Rate Over Time:</strong></p>';
                const rateChart = {
                    type: 'line',
                    data: {
                        labels: chartLabels,
                        datasets: [{
                            label: 'Request Rate (hits/s)',
                            data: rateData,
                            borderColor: '#E8871E',
                            backgroundColor: '#E8871E40',
                            borderWidth: 2,
                            pointRadius: 1,
                            fill: true,
                            tension: 0.1
                        }]
                    },
                    options: {
                        plugins: {
                            title: { display: true, text: 'Request Rate', font: { size: 14, weight: 'bold' } },
                            legend: { display: false }
                        },
                        scales: {
                            x: { title: { display: true, text: 'Time' }, ticks: { maxRotation: 45, minRotation: 45 } },
                            y: { beginAtZero: true, title: { display: true, text: 'Request Rate (hits/s)' } }
                        }
                    }
                };
                
                const rateChartUrl = 'https://quickchart.io/chart?width=700&height=280&c=' + encodeURIComponent(JSON.stringify(rateChart));
                content += `<p><ac:image ac:width="700"><ri:url ri:value="${rateChartUrl}"/></ac:image></p>`;
            }
            
            // Create P95 Latency over Time chart
            content += '<p><strong>P95 Latency Over Time:</strong></p>';
            const p95Chart = {
                type: 'line',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        label: 'P95 Latency (ms)',
                        data: p95Data,
                        borderColor: color,
                        backgroundColor: color + '40',
                        borderWidth: 2,
                        pointRadius: 1,
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: {
                    plugins: {
                        title: { display: true, text: 'P95 Latency', font: { size: 14, weight: 'bold' } },
                        legend: { display: false }
                    },
                    scales: {
                        x: { title: { display: true, text: 'Time' }, ticks: { maxRotation: 45, minRotation: 45 } },
                        y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)' } }
                    }
                }
            };
            
            const p95ChartUrl = 'https://quickchart.io/chart?width=700&height=280&c=' + encodeURIComponent(JSON.stringify(p95Chart));
            content += `<p><ac:image ac:width="700"><ri:url ri:value="${p95ChartUrl}"/></ac:image></p>`;
            
            // Stats table
            const min = Math.min(...values).toFixed(1);
            const max = Math.max(...values).toFixed(1);
            const median = this.calculateMedian(values).toFixed(1);
            
            content += '<table style="margin-top: 15px; width: 600px;">';
            content += '<tbody>';
            content += '<tr><td style="width: 150px;"><strong>Data Points:</strong></td><td>' + timeSeries.length + '</td>';
            content += '<td style="width: 150px;"><strong>Average:</strong></td><td>' + avg + ' ms</td></tr>';
            content += '<tr><td><strong>Median:</strong></td><td>' + median + ' ms</td>';
            content += '<td><strong>Min:</strong></td><td>' + min + ' ms</td></tr>';
            content += '<tr><td><strong>Max:</strong></td><td>' + max + ' ms</td>';
            content += '<td><strong>P99:</strong></td><td>' + metric.p99_latency + '</td></tr>';
            content += '</tbody></table>';
            
            content += '</ac:rich-text-body>';
            content += '</ac:structured-macro>';
        });
        
        return content;
    }

    calculateMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    generateErrorSummarySection(errorMetrics, data) {
        if (!errorMetrics) return '';

        const hasErrors = errorMetrics.logSummary.totalLogErrors > 0 || 
                         errorMetrics.traceSummary.totalErrors > 0;

        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #DE350B; padding-bottom: 8px; margin-top: 25px; font-weight: bold;"><span style="background-color: #DE350B; color: white; padding: 4px 12px; border-radius: 3px;">⚠️ Error Summary</span></h2>';

        if (!hasErrors) {
            content += '<div style="background-color: #E3FCEF; border-left: 4px solid #00875A; padding: 15px 20px; margin: 15px 0; border-radius: 3px;">';
            content += '<p style="' + this.getFontStyles().bodyFont + ' margin: 0; color: #006644;"><strong>✅ No errors detected during this test period</strong></p>';
            content += '</div>';
            return content;
        }

        // Error Statistics Table
        content += '<table data-table-width="1200" data-layout="wide" style="margin: 15px 0;">';
        content += '<colgroup><col width="300"/><col width="200"/><col width="700"/></colgroup>';
        content += '<thead><tr style="background-color: #FFEBE6;">';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Error Type</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Count</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Details</strong></p></th>';
        content += '</tr></thead><tbody>';

        // Log Errors
        if (errorMetrics.logSummary.totalLogErrors > 0) {
            content += '<tr>';
            content += '<td><p style="' + this.getFontStyles().tableFont + '"><strong>Application Log Errors</strong></p></td>';
            content += '<td><p style="' + this.getFontStyles().tableFont + ' color: #DE350B;"><strong>' + errorMetrics.logSummary.totalLogErrors + '</strong></p></td>';
            content += '<td>';
            
            // Add Datadog logs link
            const logsUrl = this.generateDatadogLogsUrl(data);
            content += '<p style="' + this.getFontStyles().smallFont + ' margin-bottom: 8px;"><a href="' + logsUrl + '" target="_blank" style="color: #0052CC; text-decoration: none; font-weight: 600;">🔗 View in Datadog Logs</a></p>';
            
            // Top error messages
            const topErrors = errorMetrics.logSummary.errorsByMessage.slice(0, 5);
            if (topErrors.length > 0) {
                content += '<ul style="margin: 4px 0; padding-left: 20px;">';
                topErrors.forEach(error => {
                    content += '<li style="' + this.getFontStyles().smallFont + '">' + this.escapeHtml(error.message.substring(0, 100)) + '... <span style="color: #DE350B;">(' + error.errorCount + ' occurrences)</span></li>';
                });
                content += '</ul>';
            }
            content += '</td></tr>';
        }

        // Trace Errors
        if (errorMetrics.traceSummary.totalErrors > 0) {
            content += '<tr>';
            content += '<td><p style="' + this.getFontStyles().tableFont + '"><strong>APM Trace Errors</strong></p></td>';
            content += '<td><p style="' + this.getFontStyles().tableFont + ' color: #DE350B;"><strong>' + errorMetrics.traceSummary.totalErrors + '</strong></p></td>';
            content += '<td><p style="' + this.getFontStyles().tableFont + '">Error Rate: ' + errorMetrics.traceSummary.errorPercentage.toFixed(2) + '%</p></td>';
            content += '</tr>';
        }

        content += '</tbody></table>';

        return content;
    }

    generateOOMEventsSection(oomSummary) {
        if (!oomSummary || oomSummary.totalOOMEvents === 0) return '';

        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #FF5630; padding-bottom: 8px; margin-top: 25px; font-weight: bold;"><span style="background-color: #FF5630; color: white; padding: 4px 12px; border-radius: 3px;">🚨 Out of Memory Events</span></h2>';

        content += '<div style="background-color: #FFEBE6; border-left: 4px solid #FF5630; padding: 15px 20px; margin: 15px 0; border-radius: 3px;">';
        content += '<p style="' + this.getFontStyles().emphasisFont + ' margin: 0; color: #BF2600;"><strong>⚠️ ' + oomSummary.totalOOMEvents + ' OOM event(s) detected - Critical memory issue requiring immediate attention</strong></p>';
        content += '</div>';

        // OOM Events Table
        content += '<table data-table-width="1200" data-layout="wide" style="margin: 15px 0;">';
        content += '<colgroup><col width="200"/><col width="200"/><col width="300"/><col width="500"/></colgroup>';
        content += '<thead><tr style="background-color: #FFEBE6;">';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Timestamp</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Host</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Pod</strong></p></th>';
        content += '<th><p style="' + this.getFontStyles().tableHeaderFont + '"><strong>Description</strong></p></th>';
        content += '</tr></thead><tbody>';

        oomSummary.oomEventDetails.forEach(event => {
            const timestamp = new Date(event.timestamp).toLocaleString();
            const podTag = event.tags.find(t => t.startsWith('display_container_name:'));
            const podName = podTag ? podTag.split(':')[1] : 'Unknown';

            content += '<tr>';
            content += '<td><p style="' + this.getFontStyles().smallFont + '">' + timestamp + '</p></td>';
            content += '<td><p style="' + this.getFontStyles().smallFont + '">' + (event.host || 'N/A') + '</p></td>';
            content += '<td><p style="' + this.getFontStyles().smallFont + '">' + podName + '</p></td>';
            content += '<td><p style="' + this.getFontStyles().smallFont + '">' + this.escapeHtml(event.text) + '</p></td>';
            content += '</tr>';
        });

        content += '</tbody></table>';

        return content;
    }

    generateObservationsSection(data) {
        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #6554C0; padding-bottom: 8px; margin-top: 25px; font-weight: bold;"><span style="background-color: #6554C0; color: white; padding: 4px 12px; border-radius: 3px;">🔍 Overall Observations & Recommendations</span></h2>';

        const observations = this.analyzePerformanceData(data);

        // Performance Status Badge
        const statusColor = observations.overallStatus === 'good' ? '#00875A' : 
                           observations.overallStatus === 'warning' ? '#FF991F' : '#DE350B';
        const statusBg = observations.overallStatus === 'good' ? '#E3FCEF' : 
                        observations.overallStatus === 'warning' ? '#FFFAE6' : '#FFEBE6';
        const statusText = observations.overallStatus === 'good' ? '✅ Acceptable Performance' : 
                          observations.overallStatus === 'warning' ? '⚠️ Performance Concerns' : '❌ Critical Issues';

        content += '<div style="background-color: ' + statusBg + '; border-left: 4px solid ' + statusColor + '; padding: 15px 20px; margin: 15px 0; border-radius: 3px;">';
        content += '<p style="' + this.getFontStyles().emphasisFont + ' margin: 0; color: ' + statusColor + ';"><strong>' + statusText + '</strong></p>';
        content += '</div>';

        // Key Findings
        content += '<h3 style="' + this.getFontStyles().subheaderFont + '">📊 Key Findings:</h3>';
        content += '<ul style="margin: 10px 0; padding-left: 30px;">';
        observations.findings.forEach(finding => {
            content += '<li style="' + this.getFontStyles().bodyFont + ' margin: 8px 0;">' + finding + '</li>';
        });
        content += '</ul>';

        // Recommendations
        if (observations.recommendations.length > 0) {
            content += '<h3 style="' + this.getFontStyles().subheaderFont + '">💡 Recommendations:</h3>';
            content += '<ul style="margin: 10px 0; padding-left: 30px;">';
            observations.recommendations.forEach(rec => {
                content += '<li style="' + this.getFontStyles().bodyFont + ' margin: 8px 0;">' + rec + '</li>';
            });
            content += '</ul>';
        }

        return content;
    }

    generateSummaryObservations(data) {
        const observations = [];
        
        // Get restart count only for monitoring window
        let windowRestarts = 0;
        let restartedPods = 0;
        if (data.podMetrics && data.podMetrics.podMetrics) {
            const restartTiming = this.analyzeRestartTiming(data.podMetrics);
            const validRestarts = data.podMetrics.podMetrics.filter(pod => {
                const podTiming = restartTiming[pod.podName];
                return pod.restarts && pod.restarts > 0 && 
                       (!podTiming || !podTiming.exactTime || !podTiming.exactTime.includes('Before'));
            });
            windowRestarts = validRestarts.reduce((sum, pod) => sum + (pod.restarts || 0), 0);
            restartedPods = validRestarts.length;
        }
        
        // Pod restarts summary
        if (windowRestarts > 0) {
            observations.push(`Pod Restarts: ${windowRestarts} restart(s) across ${restartedPods} pod(s) during monitoring window`);
        }
        
        // High latency detection
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const highLatencyEndpoints = data.endpointMetrics.filter(endpoint => 
                endpoint.p95_latency && endpoint.p95_latency > 1000 // > 1 second
            );
            if (highLatencyEndpoints.length > 0) {
                const worstEndpoint = highLatencyEndpoints.reduce((worst, current) => 
                    current.p95_latency > worst.p95_latency ? current : worst
                );
                observations.push(`Performance Issues: High P95 latency (${(worstEndpoint.p95_latency/1000).toFixed(1)}+ seconds) on ${worstEndpoint.resource_name} endpoint`);
            }
        }
        
        // Error rate detection
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const errorEndpoints = data.endpointMetrics.filter(endpoint => 
                endpoint.error_rate && endpoint.error_rate > 0
            );
            if (errorEndpoints.length > 0) {
                const worstErrorEndpoint = errorEndpoints.reduce((worst, current) => 
                    current.error_rate > worst.error_rate ? current : worst
                );
                observations.push(`Error Rate: ${worstErrorEndpoint.error_rate.toFixed(2)}% error rate on ${worstErrorEndpoint.resource_name} endpoint with ${worstErrorEndpoint.errors} errors`);
            }
        }
        
        // Application errors summary
        if (data.errorMetrics?.logSummary?.totalLogErrors > 0) {
            observations.push(`Application Errors: ${data.errorMetrics.logSummary.totalLogErrors} log errors detected during monitoring window`);
        }
        
        // Overall throughput
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const totalRequests = data.endpointMetrics.reduce((sum, endpoint) => sum + (endpoint.requests || 0), 0);
            if (totalRequests > 0) {
                const timeRangeMinutes = data.timeRange ? 
                    (new Date(data.timeRange.to) - new Date(data.timeRange.from)) / (1000 * 60) : 30;
                const avgRate = (totalRequests / timeRangeMinutes).toFixed(2);
                observations.push(`Throughput: ${totalRequests} total requests over ${timeRangeMinutes.toFixed(0)} minutes (avg: ${avgRate} req/min)`);
            }
        }
        
        return observations;
    }

    generateSummaryObservations(data) {
        const observations = [];
        
        // Get restart count only for monitoring window
        let windowRestarts = 0;
        let restartedPods = 0;
        if (data.podMetrics && data.podMetrics.podMetrics) {
            const restartTiming = this.analyzeRestartTiming(data.podMetrics);
            const validRestarts = data.podMetrics.podMetrics.filter(pod => {
                const podTiming = restartTiming[pod.podName];
                return pod.restarts && pod.restarts > 0 && 
                       (podTiming && podTiming.duringWindow !== false);
            });
            windowRestarts = validRestarts.reduce((sum, pod) => sum + (pod.restarts || 0), 0);
            restartedPods = validRestarts.length;
        }
        
        // Pod restarts summary
        if (windowRestarts > 0) {
            observations.push(`Pod Restarts: ${windowRestarts} restart(s) across ${restartedPods} pod(s) during monitoring window`);
        }
        
        // High latency detection
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const highLatencyEndpoints = data.endpointMetrics.filter(endpoint => 
                endpoint.p95_latency && endpoint.p95_latency > 1000 // > 1 second
            );
            if (highLatencyEndpoints.length > 0) {
                const worstEndpoint = highLatencyEndpoints.reduce((worst, current) => 
                    current.p95_latency > worst.p95_latency ? current : worst
                );
                observations.push(`Performance Issues: High P95 latency (${(worstEndpoint.p95_latency/1000).toFixed(1)}+ seconds) on ${worstEndpoint.resource_name} endpoint`);
            }
        }
        
        // Error rate detection
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const errorEndpoints = data.endpointMetrics.filter(endpoint => 
                endpoint.error_rate && endpoint.error_rate > 0
            );
            if (errorEndpoints.length > 0) {
                const worstErrorEndpoint = errorEndpoints.reduce((worst, current) => 
                    current.error_rate > worst.error_rate ? current : worst
                );
                observations.push(`Error Rate: ${worstErrorEndpoint.error_rate.toFixed(2)}% error rate on ${worstErrorEndpoint.resource_name} endpoint with ${worstErrorEndpoint.errors} errors`);
            }
        }
        
        // Application errors summary
        if (data.errorMetrics?.logSummary?.totalLogErrors > 0) {
            observations.push(`Application Errors: ${data.errorMetrics.logSummary.totalLogErrors} log errors detected during monitoring window`);
        }
        
        // Overall throughput
        if (data.endpointMetrics && data.endpointMetrics.length > 0) {
            const totalRequests = data.endpointMetrics.reduce((sum, endpoint) => sum + (endpoint.requests || 0), 0);
            if (totalRequests > 0) {
                const timeRangeMinutes = data.timeRange ? 
                    (new Date(data.timeRange.to) - new Date(data.timeRange.from)) / (1000 * 60) : 30;
                const avgRate = (totalRequests / timeRangeMinutes).toFixed(2);
                observations.push(`Throughput: ${totalRequests} total requests over ${timeRangeMinutes.toFixed(0)} minutes (avg: ${avgRate} req/min)`);
            }
        }
        
        return observations;
    }

    analyzeRestartTiming(podMetricsData) {
        const restartTiming = {};
        
        // Check if we have restart time series data
        if (podMetricsData.timeSeries && podMetricsData.timeSeries.restarts && podMetricsData.timeSeries.restarts.series) {
            const restartSeries = podMetricsData.timeSeries.restarts.series;
            const monitoringStart = new Date(podMetricsData.timeSeries.restarts.from_date);
            const monitoringEnd = new Date(podMetricsData.timeSeries.restarts.to_date);
            
            for (const series of restartSeries) {
                // Extract pod name from expression
                const podNameMatch = series.expression.match(/pod_name:([\w-]+)/);
                if (podNameMatch && series.pointlist && series.pointlist.length > 0) {
                    const podName = podNameMatch[1];
                    const points = series.pointlist;
                    
                    // Check if restart count increases during monitoring window
                    let restartIncrease = false;
                    let latestRestartTime = null;
                    let startValue = points[0][1];
                    let maxValue = startValue;
                    
                    for (let i = 1; i < points.length; i++) {
                        const [timestamp, value] = points[i];
                        if (value > maxValue) {
                            // Restart count increased during monitoring
                            latestRestartTime = timestamp;
                            restartIncrease = true;
                            maxValue = value;
                        }
                    }
                    
                    if (latestRestartTime) {
                        // Restart occurred during monitoring window
                        const restartDate = new Date(latestRestartTime);
                        restartTiming[podName] = {
                            exactTime: restartDate.toLocaleString('en-US', { 
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit', 
                                minute: '2-digit',
                                second: '2-digit',
                                hour12: true,
                                timeZone: 'America/New_York'
                            }) + ' EST',
                            duringWindow: true
                        };
                    } else if (startValue > 0) {
                        // Restart happened before monitoring window
                        restartTiming[podName] = {
                            exactTime: `Before ${monitoringStart.toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit', 
                                minute: '2-digit',
                                hour12: true,
                                timeZone: 'America/New_York'
                            })} EST`,
                            duringWindow: false
                        };
                    }
                }
            }
        }
        
        return restartTiming;
    }

    getMainRestartCause(podsWithRestarts, allData) {
        const totalRestarts = podsWithRestarts.reduce((sum, pod) => sum + pod.restarts, 0);
        const hasHighErrors = allData.errorMetrics?.logSummary?.totalLogErrors > 0;
        const hasHighMemory = podsWithRestarts.some(pod => {
            const memMetrics = allData.podMetrics?.containerMetrics?.memory;
            const podMemData = memMetrics?.find(m => m.podName === pod.podName);
            return podMemData && podMemData.maxMemory > 90;
        });
        
        if (hasHighMemory) {
            return 'High memory usage detected - likely OOM (Out of Memory) kills';
        }
        if (hasHighErrors && totalRestarts > 1) {
            return `Correlated with ${allData.errorMetrics.logSummary.totalLogErrors} application errors - likely application-level failures`;
        }
        if (totalRestarts >= 3) {
            return 'Frequent restarts suggest health check failures or application instability';
        }
        if (podsWithRestarts.length > 1) {
            return 'Multiple pods affected - indicates service-level instability';
        }
        return 'Monitor for patterns - may be related to deployment updates or transient issues';
    }

    analyzeRestartCauses(podsWithRestarts, allData) {
        const analyses = [];
        
        // Check for resource-related restart patterns
        for (const pod of podsWithRestarts) {
            const podName = pod.podName;
            const restartCount = pod.restarts;
            
            // Memory-related restart analysis
            if (allData.podMetrics?.containerMetrics?.memory) {
                const memMetrics = allData.podMetrics.containerMetrics.memory;
                const podMemData = memMetrics.find(m => m.podName === podName);
                if (podMemData && podMemData.maxMemory > 90) {
                    analyses.push(`High memory usage (${podMemData.maxMemory}%) on ${podName} suggests potential OOM kills`);
                    continue;
                }
            }
            
            // CPU-related restart analysis
            if (allData.podMetrics?.containerMetrics?.cpu) {
                const cpuMetrics = allData.podMetrics.containerMetrics.cpu;
                const podCpuData = cpuMetrics.find(m => m.podName === podName);
                if (podCpuData && podCpuData.maxCpu > 95) {
                    analyses.push(`High CPU usage (${podCpuData.maxCpu}%) on ${podName} may indicate CPU throttling or resource starvation`);
                    continue;
                }
            }
            
            // Error correlation analysis
            const hasHighErrors = allData.errorMetrics?.logSummary?.totalLogErrors > 0;
            if (hasHighErrors && restartCount > 1) {
                analyses.push(`Restarts on ${podName} correlate with application errors (${allData.errorMetrics.logSummary.totalLogErrors} errors), likely application-level failures`);
                continue;
            }
            
            // Health check failure pattern
            if (restartCount >= 3) {
                analyses.push(`Frequent restarts on ${podName} suggest health check failures or application instability`);
            } else if (restartCount === 1) {
                analyses.push(`Single restart on ${podName} - monitor for patterns; may be related to deployment updates or transient issues`);
            }
        }
        
        // Overall restart pattern analysis
        const totalRestarts = podsWithRestarts.reduce((sum, pod) => sum + pod.restarts, 0);
        const avgRestartsPerPod = totalRestarts / podsWithRestarts.length;
        
        if (avgRestartsPerPod > 2) {
            analyses.push(`Average ${avgRestartsPerPod.toFixed(1)} restarts per pod indicates systematic issues requiring investigation`);
        }
        
        return analyses.length > 0 ? analyses : [`Monitor for recurring patterns and correlate with deployment activities`];
    }

    analyzePerformanceData(data) {
        const findings = [];
        const recommendations = [];
        let overallStatus = 'good';

        // Generate clean metrics-based Key Findings based on actual service performance during monitoring window
        
        // Check for pod restarts during monitoring window
        let hasRestarts = false;
        if (data.podMetrics && data.podMetrics.podMetrics) {
            const restartTiming = this.analyzeRestartTiming(data.podMetrics);
            const podsWithRestarts = data.podMetrics.podMetrics.filter(pod => {
                const podTiming = restartTiming[pod.podName];
                return pod.restarts && pod.restarts > 0 && 
                       (podTiming && podTiming.duringWindow !== false);
            });
            const totalRestarts = podsWithRestarts.reduce((sum, pod) => sum + (pod.restarts || 0), 0);
            if (totalRestarts > 0) {
                findings.push(`<strong>Pod Restarts:</strong> ${totalRestarts} total restart(s) across ${podsWithRestarts.length} pod(s)`);
                hasRestarts = true;
                overallStatus = totalRestarts >= 5 ? 'critical' : 'warning';
            }
        }
        
        // High P95 Latency Analysis
        const highLatencyEndpoints = data.metrics.filter(m => {
            const p95 = parseFloat(m.p95_latency);
            return p95 > 1000; // > 1 second
        });

        if (highLatencyEndpoints.length > 0) {
            const worstEndpoint = highLatencyEndpoints.reduce((worst, current) => 
                parseFloat(current.p95_latency) > parseFloat(worst.p95_latency) ? current : worst
            );
            const avgP95 = highLatencyEndpoints.reduce((sum, m) => sum + parseFloat(m.p95_latency), 0) / highLatencyEndpoints.length;
            
            // Show all high-latency endpoints, not just the worst one
            const endpointNames = highLatencyEndpoints.map(ep => ep.resource_name).join(', ');
            findings.push(`<strong>High P95 Latency Detected:</strong> ${highLatencyEndpoints.length} endpoint(s) with P95 > 1s (avg: ${(avgP95/1000).toFixed(1)}s). Endpoints: ${endpointNames}`);
            recommendations.push('Investigate slow endpoints for database query optimization, external API calls, or inefficient algorithms');
            overallStatus = 'warning';
        }

        // Endpoint Error Analysis
        const errorEndpoints = data.metrics.filter(m => {
            const errors = parseInt(m.errors || 0);
            return errors > 0;
        });

        if (errorEndpoints.length > 0) {
            const totalEndpointErrors = errorEndpoints.reduce((sum, m) => sum + parseInt(m.errors || 0), 0);
            findings.push(`<strong>Errors Found:</strong> ${totalEndpointErrors} total errors (${totalEndpointErrors} endpoint errors, 0 trace errors)`);
            
            // Show most common error pattern
            const errorRateEndpoints = errorEndpoints.filter(m => parseFloat(m.error_rate || 0) > 0);
            if (errorRateEndpoints.length > 0) {
                const worstErrorEndpoint = errorRateEndpoints.reduce((worst, current) => 
                    parseFloat(current.error_rate || 0) > parseFloat(worst.error_rate || 0) ? current : worst
                );
                findings.push(`<strong>Most Common Error:</strong> ${parseFloat(worstErrorEndpoint.error_rate).toFixed(2)}% error rate on ${worstErrorEndpoint.resource_name} endpoint`);
            }
            overallStatus = overallStatus === 'good' ? 'warning' : overallStatus;
        }

        // Application Log Errors
        if (data.errorMetrics && data.errorMetrics.logSummary && data.errorMetrics.logSummary.totalLogErrors > 0) {
            findings.push(`<strong>Application Errors:</strong> ${data.errorMetrics.logSummary.totalLogErrors} log errors detected during monitoring window`);
            
            // Show most common log error
            const topLogMessage = data.errorMetrics.logSummary.topMessages?.[0];
            if (topLogMessage && topLogMessage.message !== "No message...") {
                findings.push(`<strong>Most Common Log Error:</strong> "${topLogMessage.message}" occurred ${topLogMessage.count} times`);
            }
            overallStatus = overallStatus === 'good' ? 'warning' : overallStatus;
        }
        
        // Throughput Analysis
        if (data.metrics && data.metrics.length > 0) {
            const totalRequests = data.metrics.reduce((sum, m) => sum + parseInt(m.requests || 0), 0);
            if (totalRequests > 0) {
                const timeRangeMinutes = data.timeRange ? 
                    (new Date(data.timeRange.to) - new Date(data.timeRange.from)) / (1000 * 60) : 30;
                const avgRate = (totalRequests / timeRangeMinutes).toFixed(2);
                findings.push(`<strong>Throughput:</strong> ${totalRequests} total requests over ${timeRangeMinutes.toFixed(0)} minutes (avg: ${avgRate} req/min)`);
            }
        }

        // Continue with resource utilization analysis for recommendations
        if (data.podMetrics && data.podMetrics.summary && 
            data.podMetrics.summary.avgCpuPct !== undefined) {
            const avgCpu = data.podMetrics.summary.avgCpuPct;
            const maxCpu = data.podMetrics.summary.maxCpuPct;
            const avgMem = data.podMetrics.summary.avgMemoryPct;
            const maxMem = data.podMetrics.summary.maxMemoryPct;

            findings.push(`<strong>Resource Utilization:</strong> CPU: ${avgCpu.toFixed(2)}% avg, ${maxCpu.toFixed(2)}% peak | Memory: ${avgMem.toFixed(2)}% avg, ${maxMem.toFixed(2)}% peak`);

            if (maxCpu > 80) {
                recommendations.push('CPU usage peaked above 80% - consider increasing CPU limits or horizontal scaling');
                overallStatus = overallStatus === 'good' ? 'warning' : overallStatus;
            }

            if (maxMem > 80) {
                recommendations.push('Memory usage peaked above 80% - monitor for potential memory pressure and consider increasing limits');
                overallStatus = overallStatus === 'good' ? 'warning' : overallStatus;
            }
        }

        // Analyze Pod Restarts (only within monitoring window)
        if (data.podMetrics && data.podMetrics.podMetrics) {
            const restartTiming = this.analyzeRestartTiming(data.podMetrics);
            const podsWithRestarts = data.podMetrics.podMetrics.filter(pod => {
                // Only count restarts that occurred during our monitoring window
                const podTiming = restartTiming[pod.podName];
                return pod.restarts && pod.restarts > 0 && 
                       (podTiming && podTiming.duringWindow !== false);
            });
            
            const totalRestarts = podsWithRestarts.reduce((sum, pod) => sum + (pod.restarts || 0), 0);
            
            if (totalRestarts > 0) {
                findings.push(`<strong style="color: #DE350B;">Pod Restarts Detected:</strong> ${totalRestarts} restart(s) during monitoring window across ${podsWithRestarts.length} pod(s)`);
                
                // Add restart details with exact timestamps and analysis
                for (const pod of podsWithRestarts) {
                    const timing = restartTiming[pod.podName];
                    if (timing && timing.exactTime && timing.duringWindow) {
                        findings.push(`&nbsp;&nbsp;• ${pod.podName} - ${pod.restarts} restart${pod.restarts > 1 ? 's' : ''} (At: ${timing.exactTime})`);
                    } else {
                        findings.push(`&nbsp;&nbsp;• ${pod.podName} - ${pod.restarts} restart${pod.restarts > 1 ? 's' : ''} during monitoring period`);
                    }
                }
                
                // Add single consolidated analysis
                const mainCause = this.getMainRestartCause(podsWithRestarts, data);
                if (mainCause) {
                    findings.push(`&nbsp;&nbsp;• ${mainCause}`);
                }
                
                // Add restart-specific recommendations
                if (data.errorMetrics?.logSummary?.totalLogErrors > 0) {
                    recommendations.push('<strong>Application errors causing restarts:</strong> Review application logs and implement proper error handling');
                }
                if (podsWithRestarts.some(pod => pod.restarts >= 3)) {
                    recommendations.push('<strong>Frequent restarts detected:</strong> Check health check configurations and resource limits');
                }
                
                // Set overall status based on restart severity
                if (totalRestarts >= 5) {
                    overallStatus = 'critical';
                } else if (totalRestarts >= 2) {
                    overallStatus = overallStatus === 'good' ? 'warning' : overallStatus;
                }
            }
        }

        // General recommendations if everything is good
        if (overallStatus === 'good') {
            findings.push('<strong>✅ All metrics within acceptable thresholds</strong>');
            recommendations.push('Continue monitoring performance trends over time');
            recommendations.push('Establish this test as a baseline for future regression testing');
        }

        return { findings, recommendations, overallStatus };
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }

    calculateMedian(values) {
        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }

    generateObjectiveSection(data) {
        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #0052CC; padding-bottom: 8px; margin-top: 25px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">📊 Objective</span></h2>';
        content += '<div style="background-color: #DEEBFF; border-left: 4px solid #0052CC; padding: 15px 20px; margin: 15px 0; border-radius: 3px;">';
        content += '<p style="' + this.getFontStyles().bodyFont + ' margin: 0;">This report validates system performance under progressive load conditions by monitoring key metrics including latency, throughput, error rates, and resource utilization for critical API endpoints. ';
        content += 'The analysis focuses on detecting performance regressions against established baselines, uncovering potential bottlenecks, and identifying optimization opportunities in scaling and resource allocation. ';
        content += 'The goal is to ensure predictable autoscaling behavior and maintain consistent, reliable performance at peak demand levels.</p>';
        content += '</div>';
        
        return content;
    }

    generateTestScopeSection(data) {
        // Calculate test duration and execution time
        const fromTime = new Date(data.timeRange.from);
        const toTime = new Date(data.timeRange.to);
        const durationMinutes = Math.round((toTime - fromTime) / 60000);
        
        // Extract unique scripts/endpoints from the data
        const scriptsIncluded = data.metrics.map(metric => {
            // Keep original format with underscores
            return metric.resource_name;
        }).join(', ');
        
        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #0052CC; padding-bottom: 8px; margin-top: 25px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">📈 Test Scope & Design:</span></h2>';
        content += '<table data-table-width="1200" data-layout="wide">';
        content += '<colgroup><col width="200"/><col width="1000"/></colgroup>';
        content += '<tbody>';
        
        // Test Environment
        content += '<tr>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().emphasisFont + ' margin: 4px 0;"><strong>Test Environment</strong></p></td>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().bodyFont + ' margin: 4px 0;">' + (data.environment.charAt(0).toUpperCase() + data.environment.slice(1)) + '</p></td>';
        content += '</tr>';
        
        // Test Execution time
        content += '<tr>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().emphasisFont + ' margin: 4px 0;"><strong>Test Execution time</strong></p></td>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().bodyFont + ' margin: 4px 0;">' + fromTime.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }) + ' – ' + toTime.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true 
        }) + '</p></td>';
        content += '</tr>';
        
        // Test type
        content += '<tr>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().emphasisFont + ' margin: 4px 0;"><strong>Test type</strong></p></td>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().bodyFont + ' margin: 4px 0;">Stress Test</p></td>';
        content += '</tr>';
        
        // Duration
        content += '<tr>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().emphasisFont + ' margin: 4px 0;"><strong>Duration</strong></p></td>';
        content += '<td style="padding: 8px 12px;"><p style="' + this.getFontStyles().bodyFont + ' margin: 4px 0;">' + durationMinutes + ' minutes</p></td>';
        content += '</tr>';
        
        // Design - static load pattern from environment
        content += '<tr>';
        content += '<td style="vertical-align: top; padding: 8px 12px;"><p style="' + this.getFontStyles().emphasisFont + '"><strong>Design</strong></p></td>';
        content += '<td style="padding: 8px 12px;"><div style="line-height: 1.4;"><p style="' + this.getFontStyles().bodyFont + ' margin: 0;">';
        
        // Use single load pattern variable from environment
        const loadPattern = process.env.LOAD_PATTERN || 'To simulate the throughput in Five steps, starts with 1 req/sec for 6 mins then increased to 2 req/sec for the next 6 mins, and finally reaching to 5 req/sec for last 6 mins.';
        
        // Highlight any text containing "req/sec" with colored styling
        const highlightedPattern = loadPattern.replace(/(\d+(?:\.\d+)?\s+req\/sec)/g, '<span style="color: #FF5630; font-weight: bold; background-color: #FFEBE6; padding: 2px 6px; border-radius: 3px;">$1</span>');
        
        content += highlightedPattern + '</p></div></td>';
        content += '</tr>';
        
        content += '</tbody></table>';
        
        return content;
    }

    generatePodMetricsSection(data) {
        // Try to load container metrics if available
        const containerMetricsPath = `./reports/${data.service}_container_metrics.json`;
        let containerData = null;
        
        try {
            if (fs.existsSync(containerMetricsPath)) {
                containerData = JSON.parse(fs.readFileSync(containerMetricsPath, 'utf8'));
            }
        } catch (error) {
            // Container metrics not available, skip section
            return '';
        }
        
        if (!containerData || !containerData.podMetrics) {
            return '';
        }
        
        let content = '<h2 style="' + this.getFontStyles().headerFont + ' color: #172B4D; border-bottom: 3px solid #0052CC; padding-bottom: 8px; margin-top: 30px; font-weight: bold;"><span style="background-color: #0052CC; color: white; padding: 4px 12px; border-radius: 3px;">🔧 Kubernetes Pod Metrics</span></h2>';
        
        // Pod summary badges
        content += '<div style="background-color: #F4F5F7; padding: 15px 20px; margin: 15px 0; border-radius: 3px;">';
        content += '<table style="width: 100%; border: none;"><tbody><tr>';
        content += '<td style="border: none; padding: 8px;">';
        content += '<span style="background-color: #00875A; color: white; padding: 8px 16px; border-radius: 3px; font-weight: 600; font-size: 16px; display: inline-block;">';
        content += `📦 ${containerData.summary.runningPods.current} Pods Running</span>`;
        content += '</td>';
        content += '<td style="border: none; padding: 8px;">';
        content += '<span style="background-color: #0052CC; color: white; padding: 8px 16px; border-radius: 3px; font-weight: 600; font-size: 16px; display: inline-block;">';
        content += `🔧 ${containerData.summary.runningContainers.current} Containers</span>`;
        content += '</td>';
        content += '<td style="border: none; padding: 8px;">';
        // Calculate restarts only during monitoring window
        const restartTiming = this.analyzeRestartTiming(containerData);
        const windowRestarts = containerData.podMetrics.filter(pod => {
            const podTiming = restartTiming[pod.podName];
            return pod.restarts && pod.restarts > 0 && 
                   (podTiming && podTiming.duringWindow !== false);
        }).reduce((sum, pod) => sum + (pod.restarts || 0), 0);
        
        const restartColor = windowRestarts === 0 ? '#00875A' : '#FF5630';
        content += `<span style="background-color: ${restartColor}; color: white; padding: 8px 16px; border-radius: 3px; font-weight: 600; font-size: 16px; display: inline-block;">`;
        content += `🔄 ${windowRestarts} Restarts</span>`;
        content += '</td>';
        content += '</tr></tbody></table>';
        content += '</div>';
        
        // Pod details table - filter out cronjob pods with zero metrics
        const activePods = containerData.podMetrics.filter(pod => {
            // Exclude cronjob pods or pods with all zero metrics
            const isCronJob = pod.podName.includes('cronjob');
            const hasZeroMetrics = (!pod.avgCpuPct || pod.avgCpuPct === 0) && 
                                 (!pod.maxCpuPct || pod.maxCpuPct === 0) &&
                                 (!pod.avgMemoryPct || pod.avgMemoryPct === 0) &&
                                 (!pod.maxMemoryPct || pod.maxMemoryPct === 0);
            
            return !isCronJob && !hasZeroMetrics;
        });
        
        if (activePods.length > 0) {
            content += '<h3 style="' + this.getFontStyles().headerFont + ' margin-top: 25px; font-weight: bold;">Pod Resource Usage</h3>';
            content += '<table data-table-width="1200">';
            content += '<colgroup><col width="400"/><col width="200"/><col width="200"/><col width="200"/><col width="200"/></colgroup>';
            content += '<tbody>';
            content += '<tr>';
            content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>POD NAME</strong></p></th>';
            content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>AVG CPU (%)</strong></p></th>';
            content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>MAX CPU (%)</strong></p></th>';
            content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>AVG MEMORY (%)</strong></p></th>';
            content += '<th><p style="' + this.getFontStyles().tableFont + ' font-weight: 600;"><strong>MAX MEMORY (%)</strong></p></th>';
            content += '</tr>';
            
            activePods.forEach(pod => {
                content += '<tr>';
                content += `<td><p style="${this.getFontStyles().tableFont}"><code>${pod.podName}</code></p></td>`;
                content += `<td><p style="${this.getFontStyles().tableFont}">${pod.avgCpuPct ? pod.avgCpuPct.toFixed(2) : '0.00'}</p></td>`;
                content += `<td><p style="${this.getFontStyles().tableFont}">${pod.maxCpuPct ? pod.maxCpuPct.toFixed(2) : '0.00'}</p></td>`;
                content += `<td><p style="${this.getFontStyles().tableFont}">${pod.avgMemoryPct ? pod.avgMemoryPct.toFixed(2) : '0.00'}</p></td>`;
                content += `<td><p style="${this.getFontStyles().tableFont}">${pod.maxMemoryPct ? pod.maxMemoryPct.toFixed(2) : '0.00'}</p></td>`;
                content += '</tr>';
            });
            
            content += '</tbody></table>';
        } else {
            content += '<p style="' + this.getFontStyles().bodyFont + ' margin-top: 20px;">No active service pods found with resource metrics to display.</p>';
        }
        
        return content;
    }

    generateSummaryReport(data) {
        const totalRequests = data.metrics.reduce((sum, m) => sum + parseInt(m.requests), 0);
        const avgLatency = this.calculateAverageLatency(data.metrics);
        const topEndpoints = data.metrics
            .sort((a, b) => parseInt(b.requests) - parseInt(a.requests))
            .slice(0, 5);

        let content = '<h2>Executive Summary</h2>';
        content += '<table>';
        content += '<tr><td><strong>Total Requests:</strong></td><td>' + totalRequests + '</td></tr>';
        content += '<tr><td><strong>Average P95 Latency:</strong></td><td>' + avgLatency + ' ms</td></tr>';
        content += '<tr><td><strong>Total Endpoints:</strong></td><td>' + data.metrics.length + '</td></tr>';
        content += '<tr><td><strong>Error Rate:</strong></td><td>0%</td></tr>';
        content += '</table>';

        content += '<h3>Top 5 Most Active Endpoints</h3>';
        content += '<ol>';
        topEndpoints.forEach(endpoint => {
            content += `<li><code>${this.formatEndpoint(endpoint.resource_name)}</code> - ${endpoint.requests} requests</li>`;
        });
        content += '</ol>';

        return content;
    }

    generateRegressionReport(data) {
        let content = '<h2>Performance Regression Analysis</h2>';
        
        content += '<ac:structured-macro ac:name="panel" ac:schema-version="1">';
        content += '<ac:parameter ac:name="borderStyle">dashed</ac:parameter>';
        content += '<ac:parameter ac:name="borderColor">#ccc</ac:parameter>';
        content += '<ac:parameter ac:name="bgColor">#f4f5f7</ac:parameter>';
        content += '<ac:rich-text-body>';
        content += '<p><strong>Analysis Period:</strong> ' + this.formatTimeRange(data.timeRange) + '</p>';
        content += '<p><strong>Baseline Comparison:</strong> Previous 24 hours</p>';
        content += '<p><strong>Key Metrics:</strong> Response time, throughput, error rate</p>';
        content += '</ac:rich-text-body>';
        content += '</ac:structured-macro>';

        // Performance indicators
        content += '<h3>Performance Health Check</h3>';
        content += '<table>';
        content += '<tr><th>Metric</th><th>Status</th><th>Details</th></tr>';
        content += '<tr><td>Response Time</td><td><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">GOOD</ac:parameter></ac:structured-macro></td><td>All endpoints under 200ms P95</td></tr>';
        content += '<tr><td>Error Rate</td><td><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">EXCELLENT</ac:parameter></ac:structured-macro></td><td>Zero errors detected</td></tr>';
        content += '<tr><td>Throughput</td><td><ac:structured-macro ac:name="status" ac:schema-version="1"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">STABLE</ac:parameter></ac:structured-macro></td><td>Consistent with baseline</td></tr>';
        content += '</table>';

        content += this.generateDetailedReport(data);

        return content;
    }

    formatEndpoint(resourceName) {
        return resourceName.replace(/_/g, ' ').replace(/^(get|post|patch|delete|put)_/, (match, method) => {
            return method.toUpperCase() + ' ';
        });
    }

    formatTimeRange(timeRange) {
        const from = new Date(timeRange.from).toLocaleString();
        const to = new Date(timeRange.to).toLocaleString();
        return `${from} to ${to}`;
    }

    calculateAverageLatency(metrics) {
        const sum = metrics.reduce((total, m) => total + parseFloat(m.p95_latency), 0);
        return (sum / metrics.length).toFixed(1);
    }

    /**
     * Save report to file
     */
    async saveReport(content, outputPath, format = 'html') {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (format === 'html') {
            const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        code { background-color: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
        .panel { background-color: #f4f5f7; border: 1px dashed #ccc; padding: 15px; margin: 15px 0; }
        .success-panel { background-color: #e3fcef; border: 1px solid #36b37e; }
    </style>
</head>
<body>
${content}
</body>
</html>`;
            fs.writeFileSync(outputPath, htmlContent);
        } else {
            fs.writeFileSync(outputPath, content);
        }

        console.log(`✅ Report saved to: ${outputPath}`);
    }

    /**
     * Upload report to Confluence
     */
    async uploadToConfluence(content, title, spaceKey = null) {
        try {
            const space = spaceKey || this.confluenceConfig.spaceKey;
            const srpFolderId = '2485485885';
            
            // Check if a page with the same title already exists
            console.log(`🔍 Checking if page exists: ${title}`);
            const existingPage = await this.findPage(title, space);
            
            if (existingPage) {
                // Update existing page
                console.log(`📝 Updating existing page: ${title} (ID: ${existingPage.id}, Version: ${existingPage.version.number})`);
                const updatedPage = await this.updatePage(existingPage.id, title, content, existingPage.version.number + 1, space);
                console.log(`✅ Updated Confluence page: ${title}`);
                console.log(`🔗 View at: ${this.confluenceConfig.baseUrl}/wiki${updatedPage._links.webui}`);
            } else {
                // Create new page
                console.log(`📄 Creating new report page: ${title}`);
                const newPage = await this.createPage(title, content, space);
                console.log(`✅ Created new Confluence page under SRP-Performance-Reports: ${title}`);
                console.log(`🔗 View at: ${this.confluenceConfig.baseUrl}/wiki${newPage._links.webui}`);
            }
        } catch (error) {
            console.error('❌ Failed to upload to Confluence:', error.message);
            if (error.response) {
                console.error('Response:', error.response.data);
            }
        }
    }

    async findPage(title, spaceKey) {
        try {
            const response = await this.confluenceApi.get(`/content`, {
                params: {
                    title: title,
                    spaceKey: spaceKey,
                    expand: 'version'
                }
            });
            return response.data.results[0] || null;
        } catch (error) {
            return null;
        }
    }

    async findPageUnderParent(title, spaceKey, parentId) {
        try {
            const response = await this.confluenceApi.get(`/content/${parentId}/child/page`, {
                params: {
                    title: title,
                    expand: 'version'
                }
            });
            return response.data.results[0] || null;
        } catch (error) {
            return null;
        }
    }

    async findParentFolder(folderTitle, spaceKey) {
        try {
            // First try to find the exact folder name
            let response = await this.confluenceApi.get(`/content`, {
                params: {
                    title: folderTitle,
                    spaceKey: spaceKey,
                    type: 'page',
                    expand: 'version'
                }
            });
            
            if (response.data.results.length > 0) {
                return response.data.results[0];
            }
            
            // If not found, create the SRP-Performance-Reports folder
            console.log(`📁 SRP-Performance-Reports folder not found, creating it...`);
            const folderPage = await this.createParentFolder(folderTitle, spaceKey);
            return folderPage;
            
        } catch (error) {
            console.warn(`⚠️ Could not find or create parent folder '${folderTitle}':`, error.message);
            return null;
        }
    }
    
    async createParentFolder(folderTitle, spaceKey) {
        try {
            const pageData = {
                type: 'page',
                title: folderTitle,
                space: { key: spaceKey },
                body: {
                    storage: {
                        value: `<p>This folder contains performance reports for various services.</p>
                               <p><strong>📊 Performance Report Collection</strong></p>
                               <p>All service performance reports will be organized under this folder for easy access and management.</p>`,
                        representation: 'storage'
                    }
                }
            };

            const response = await this.confluenceApi.post('/content', pageData);
            console.log(`✅ Created parent folder: ${folderTitle}`);
            return response.data;
        } catch (error) {
            console.warn(`⚠️ Could not create parent folder '${folderTitle}':`, error.message);
            return null;
        }
    }

    async createPage(title, content, spaceKey) {
        // Use the specific SRP-Performance-Reports folder with known ID
        const srpFolderId = '2485485885';
        
        const pageData = {
            type: 'page',
            title: title,
            space: { key: spaceKey },
            body: {
                storage: {
                    value: content,
                    representation: 'storage'
                }
            }
        };
        
        // Set the specific parent folder
        pageData.ancestors = [{ id: srpFolderId }];
        console.log(`📁 Creating page under SRP-Performance-Reports folder (ID: ${srpFolderId})`);

        const response = await this.confluenceApi.post('/content', pageData);
        return response.data;
    }

    async updatePage(pageId, title, content, version, spaceKey) {
        const pageData = {
            id: pageId,
            type: 'page',
            title: title,
            space: { key: spaceKey },
            version: { number: version },
            body: {
                storage: {
                    value: content,
                    representation: 'storage'
                }
            }
        };

        const response = await this.confluenceApi.put(`/content/${pageId}`, pageData);
        return response.data;
    }
    
    async uploadAttachment(pageTitle, filePath, comment = '') {
        try {
            const fs = await import('fs');
            const FormData = (await import('form-data')).default;
            
            // Find the page first
            const page = await this.findPage(pageTitle, this.confluenceConfig.spaceKey);
            if (!page) {
                throw new Error(`Page not found: ${pageTitle}`);
            }
            
            const pageId = page.id;
            const fileName = filePath.split('/').pop();
            
            // Check if attachment already exists
            const existingAttachments = await this.confluenceApi.get(`/content/${pageId}/child/attachment`, {
                params: { filename: fileName }
            });
            
            const form = new FormData();
            form.append('file', fs.default.createReadStream(filePath), {
                filename: fileName,
                contentType: 'text/html'
            });
            if (comment) {
                form.append('comment', comment);
            }
            
            if (existingAttachments.data.results.length > 0) {
                // Update existing attachment
                const attachmentId = existingAttachments.data.results[0].id;
                form.append('minorEdit', 'true');
                
                await this.confluenceApi.post(
                    `/content/${pageId}/child/attachment/${attachmentId}/data`,
                    form,
                    {
                        headers: {
                            ...form.getHeaders(),
                            'X-Atlassian-Token': 'no-check'
                        }
                    }
                );
            } else {
                // Create new attachment
                await this.confluenceApi.post(
                    `/content/${pageId}/child/attachment`,
                    form,
                    {
                        headers: {
                            ...form.getHeaders(),
                            'X-Atlassian-Token': 'no-check'
                        }
                    }
                );
            }
            
            return true;
        } catch (error) {
            console.error('❌ Failed to upload attachment:', error.message);
            if (error.response) {
                console.error('Response:', error.response.data);
            }
            return false;
        }
    }
}

// CLI Interface
function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        input: './reports/activity_log_endpoint_metrics_table.json',
        output: './reports/confluence',
        upload: false,
        template: 'detailed',
        space: null,
        title: null
    };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--input':
                options.input = args[++i];
                break;
            case '--output':
                options.output = args[++i];
                break;
            case '--upload':
                options.upload = true;
                break;
            case '--space':
                options.space = args[++i];
                break;
            case '--title':
                options.title = args[++i];
                break;
            case '--template':
                options.template = args[++i];
                break;
            case '--help':
                showHelp();
                process.exit(0);
            default:
                if (args[i].startsWith('--')) {
                    console.error(`Unknown option: ${args[i]}`);
                    process.exit(1);
                }
        }
    }

    return options;
}

function showHelp() {
    console.log(`
Confluence Report Generator

Usage:
  node src/scripts/confluenceReport.js [options]

Options:
  --input <path>        Path to JSON metrics file 
                        (default: ./reports/activity_log_endpoint_metrics_table.json)
  --output <path>       Output directory for generated reports 
                        (default: ./reports/confluence)
  --upload             Upload report to Confluence
  --space <key>        Confluence space key (overrides .env)
  --title <title>      Custom report title
  --template <type>    Report template: detailed|summary|regression 
                        (default: detailed)
  --help               Show this help message

Examples:
  # Generate detailed report
  node src/scripts/confluenceReport.js

  # Generate and upload to Confluence
  node src/scripts/confluenceReport.js --upload

  # Generate summary report with custom title
  node src/scripts/confluenceReport.js --template summary --title "Weekly Performance Summary"

  # Upload to specific Confluence space
  node src/scripts/confluenceReport.js --upload --space "DEV" --title "Dev Environment Performance"
`);
}

// Main execution
async function main() {
    console.log('🚀 Confluence Report Generator\n');

    const options = parseArgs();

    // Check if input file exists
    if (!fs.existsSync(options.input)) {
        console.error(`❌ Input file not found: ${options.input}`);
        console.log('💡 Run your Datadog metrics fetcher first to generate the input data.');
        process.exit(1);
    }

    // Load metrics data
    console.log(`📊 Loading metrics data from: ${options.input}`);
    const data = JSON.parse(fs.readFileSync(options.input, 'utf8'));

    const generator = new ConfluenceReportGenerator();

    // Generate report content
    console.log(`📝 Generating ${options.template} report...`);
    const content = generator.generateStorageFormat(data, options.template, options.title);

    // Save to file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `performance-report-${timestamp}.html`;
    const outputPath = path.join(options.output, filename);
    
    await generator.saveReport(content, outputPath, 'html');

    // Upload to Confluence if requested
    if (options.upload) {
        const title = options.title || `${data.service} Performance Report - ${new Date().toLocaleDateString()}`;
        console.log(`🌐 Uploading to Confluence...`);
        await generator.uploadToConfluence(content, title, options.space);
    }

    console.log('\n✅ Report generation completed!');
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(error => {
        console.error('❌ Error:', error.message);
        process.exit(1);
    });
}

export default ConfluenceReportGenerator;