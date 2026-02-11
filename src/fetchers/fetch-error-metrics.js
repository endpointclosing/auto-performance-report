import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

// Create axios instance with SSL configuration
const axiosInstance = axios.create({
    httpsAgent: new https.Agent({
        rejectUnauthorized: false
    })
});

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;

const parseDateTime = (dateTimeStr) => {
    const months = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
    };

    const match = dateTimeStr.match(/^(\w+)\s+(\d+),\s+(\d+):(\d+)\s+(am|pm)$/i);
    if (!match) throw new Error(`Invalid date format: ${dateTimeStr}`);

    const [, month, day, hour, minute, period] = match;
    let hours = parseInt(hour);
    if (period.toLowerCase() === 'pm' && hours !== 12) hours += 12;
    if (period.toLowerCase() === 'am' && hours === 12) hours = 0;

    const date = new Date(2026, months[month], parseInt(day), hours, parseInt(minute));
    return Math.floor(date.getTime() / 1000);
};

const fetchErrorMetrics = async (service, from, to) => {
    const fromTimestamp = parseDateTime(from);
    const toTimestamp = parseDateTime(to);

    console.log(`\n🔍 Fetching error metrics for ${service}...`);
    console.log(`📅 Time range: ${new Date(fromTimestamp * 1000).toISOString()} to ${new Date(toTimestamp * 1000).toISOString()}\n`);

    // Helper function to retry API calls
    const retryApiCall = async (apiCall, maxRetries = 3) => {
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await apiCall();
            } catch (error) {
                console.log(`   ⚠️  Attempt ${i + 1} failed: ${error.response?.status} ${error.response?.statusText || error.message}`);

                if (i === maxRetries - 1) {
                    throw error; // Re-throw on final attempt
                }

                // Wait before retrying (exponential backoff)
                const delay = Math.pow(2, i) * 1000;
                console.log(`   ⏳ Waiting ${delay}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    };

    try {
        // Fetch OOM (Out of Memory) events with retry logic
        console.log(`🔍 Fetching OOM events...`);

        let oomEventsResponse;
        try {
            oomEventsResponse = await retryApiCall(() =>
                axiosInstance.get('https://api.datadoghq.com/api/v1/events', {
                    params: {
                        start: fromTimestamp,
                        end: toTimestamp,
                        tags: `service:${service}`,
                        priority: 'all'
                    },
                    headers: {
                        'DD-API-KEY': DD_API_KEY,
                        'DD-APPLICATION-KEY': DD_APP_KEY
                    },
                    timeout: 10000 // 10 second timeout
                })
            );
        } catch (eventError) {
            console.warn(`⚠️  Could not fetch OOM events (${eventError.response?.status || 'unknown error'}), continuing without OOM data...`);
            oomEventsResponse = { data: { events: [] } };
        }

        const allEvents = oomEventsResponse.data?.events || [];

        // Filter for OOM-related events
        const oomEvents = allEvents.filter(event => {
            const title = (event.title || '').toLowerCase();
            const text = (event.text || '').toLowerCase();
            return title.includes('out of memory') ||
                title.includes('oom') ||
                title.includes('memory') ||
                text.includes('out of memory') ||
                text.includes('oomkilled');
        });

        console.log(`📊 Found ${oomEvents.length} OOM-related events out of ${allEvents.length} total events`);

        // Fetch log-based errors using Logs API - try multiple query variations
        const logsQueries = [
            `service:${service} env:staging status:error`,
            `service:${service} level:error`,
            `@service:${service} @env:staging status:error`,
            `service:${service} status:error OR level:error`
        ];

        let logs = [];
        let successfulQuery = '';

        for (const query of logsQueries) {
            try {
                console.log(`📝 Trying query: ${query}`);

                const logsResponse = await retryApiCall(() =>
                    axiosInstance.post('https://api.datadoghq.com/api/v2/logs/events/search', {
                        filter: {
                            query: query,
                            from: new Date(fromTimestamp * 1000).toISOString(),
                            to: new Date(toTimestamp * 1000).toISOString()
                        },
                        page: {
                            limit: 1000
                        },
                        sort: '-timestamp'
                    }, {
                        timeout: 15000, // 15 second timeout
                        headers: {
                            'DD-API-KEY': DD_API_KEY,
                            'DD-APPLICATION-KEY': DD_APP_KEY,
                            'Content-Type': 'application/json'
                        }
                    })
                );

                const foundLogs = logsResponse.data?.data || [];
                if (foundLogs.length > 0) {
                    logs = foundLogs;
                    successfulQuery = query;
                    console.log(`✅ Found ${logs.length} error logs with query: ${query}`);
                    break;
                }
            } catch (err) {
                console.log(`   ⚠️  Query failed: ${err.message}`);
                continue;
            }
        }

        if (logs.length === 0) {
            console.log(`📊 No error logs found with any query`);
        }

        // Also fetch trace-based errors for comparison
        const errorCountQuery = `sum:trace.express.request.errors{env:staging,service:${service}}.as_count()`;
        const errorRateQuery = `sum:trace.express.request.errors{env:staging,service:${service}}.as_rate()`;
        const totalRequestsQuery = `sum:trace.express.request.hits{env:staging,service:${service}}.as_count()`;

        const [errorCountResponse, errorRateResponse, totalRequestsResponse] = await Promise.allSettled([
            retryApiCall(() => axiosInstance.get('https://api.datadoghq.com/api/v1/query', {
                params: { query: errorCountQuery, from: fromTimestamp, to: toTimestamp },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                timeout: 10000
            })),
            retryApiCall(() => axiosInstance.get('https://api.datadoghq.com/api/v1/query', {
                params: { query: errorRateQuery, from: fromTimestamp, to: toTimestamp },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                timeout: 10000
            })),
            retryApiCall(() => axiosInstance.get('https://api.datadoghq.com/api/v1/query', {
                params: { query: totalRequestsQuery, from: fromTimestamp, to: toTimestamp },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                timeout: 10000
            }))
        ]);

        // Handle settled promises
        const errorCountData = errorCountResponse.status === 'fulfilled'
            ? errorCountResponse.value.data?.series?.[0]?.pointlist || []
            : [];
        const errorRateData = errorRateResponse.status === 'fulfilled'
            ? errorRateResponse.value.data?.series?.[0]?.pointlist || []
            : [];
        const totalRequestsData = totalRequestsResponse.status === 'fulfilled'
            ? totalRequestsResponse.value.data?.series?.[0]?.pointlist || []
            : [];

        // Calculate total errors and error rate (data already extracted above)

        const totalErrors = errorCountData.reduce((sum, [, value]) => sum + (value || 0), 0);
        const totalRequests = totalRequestsData.reduce((sum, [, value]) => sum + (value || 0), 0);
        const avgErrorRate = errorRateData.length > 0
            ? errorRateData.reduce((sum, [, value]) => sum + (value || 0), 0) / errorRateData.length
            : 0;
        const errorPercentage = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

        // Fetch error details by resource (endpoint) with retry logic
        const resourceQuery = `sum:trace.express.request.errors{env:staging,service:${service}} by {resource_name}.as_count()`;
        let resourceResponse;
        try {
            resourceResponse = await retryApiCall(() => axiosInstance.get('https://api.datadoghq.com/api/v1/query', {
                params: { query: resourceQuery, from: fromTimestamp, to: toTimestamp },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                timeout: 10000
            }));
        } catch (error) {
            console.warn(`⚠️  Could not fetch resource error data: ${error.message}`);
            resourceResponse = { data: { series: [] } };
        }

        const errorsByResource = (resourceResponse.data?.series || []).map(series => {
            const resourceName = series.scope || 'unknown';
            const errorCount = series.pointlist.reduce((sum, [, value]) => sum + (value || 0), 0);
            return {
                resource: resourceName.replace('resource_name:', ''),
                errorCount: Math.round(errorCount),
                timeSeries: series.pointlist.map(([timestamp, value]) => ({
                    timestamp: new Date(timestamp).toISOString(),
                    errors: value || 0
                }))
            };
        }).filter(item => item.errorCount > 0)
            .sort((a, b) => b.errorCount - a.errorCount);

        // Fetch error details by error type with retry logic
        const errorTypeQuery = `sum:trace.express.request.errors{env:staging,service:${service}} by {error.type}.as_count()`;
        let errorTypeResponse;
        try {
            errorTypeResponse = await retryApiCall(() => axiosInstance.get('https://api.datadoghq.com/api/v1/query', {
                params: { query: errorTypeQuery, from: fromTimestamp, to: toTimestamp },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                timeout: 10000
            }));
        } catch (error) {
            console.warn(`⚠️  Could not fetch error type data: ${error.message}`);
            errorTypeResponse = { data: { series: [] } };
        }

        const errorsByType = (errorTypeResponse.data?.series || []).map(series => {
            const errorType = series.scope || 'unknown';
            const errorCount = series.pointlist.reduce((sum, [, value]) => sum + (value || 0), 0);
            return {
                errorType: errorType.replace('error.type:', '') || 'Unknown',
                errorCount: Math.round(errorCount),
                timeSeries: series.pointlist.map(([timestamp, value]) => ({
                    timestamp: new Date(timestamp).toISOString(),
                    errors: value || 0
                }))
            };
        }).filter(item => item.errorCount > 0)
            .sort((a, b) => b.errorCount - a.errorCount);

        // Process log-based errors
        const logErrorsByType = {};
        const logErrorsByMessage = {};
        const logErrorDetails = [];

        logs.forEach(log => {
            const attributes = log.attributes?.attributes || {};
            const errorType = attributes['error.kind'] || attributes['error.type'] || 'Unknown';
            const errorMessage = attributes.message || attributes.error?.message || 'No message';
            const timestamp = log.attributes?.timestamp;

            // Count by type
            logErrorsByType[errorType] = (logErrorsByType[errorType] || 0) + 1;

            // Count by message (first 100 chars)
            const shortMessage = errorMessage.substring(0, 100);
            logErrorsByMessage[shortMessage] = (logErrorsByMessage[shortMessage] || 0) + 1;

            // Store error details
            logErrorDetails.push({
                timestamp: timestamp,
                errorType: errorType,
                message: errorMessage,
                field: attributes['error.field'] || null,
                stack: attributes['error.stack'] || attributes.stack || null,
                host: attributes.host || null,
                pod: attributes.pod_name || null
            });
        });

        const logErrorsByTypeArray = Object.entries(logErrorsByType).map(([type, count]) => ({
            errorType: type,
            errorCount: count
        })).sort((a, b) => b.errorCount - a.errorCount);

        const logErrorsByMessageArray = Object.entries(logErrorsByMessage).map(([message, count]) => ({
            message: message,
            errorCount: count
        })).sort((a, b) => b.errorCount - a.errorCount);

        // Process OOM events
        const oomEventDetails = oomEvents.map(event => ({
            timestamp: new Date(event.date_happened * 1000).toISOString(),
            title: event.title,
            text: event.text,
            priority: event.priority,
            alertType: event.alert_type,
            host: event.host || null,
            tags: event.tags || []
        }));

        const result = {
            service,
            timeRange: {
                from: new Date(fromTimestamp * 1000).toISOString(),
                to: new Date(toTimestamp * 1000).toISOString()
            },
            traceSummary: {
                totalErrors: Math.round(totalErrors),
                totalRequests: Math.round(totalRequests),
                errorRate: avgErrorRate,
                errorPercentage: parseFloat(errorPercentage.toFixed(2))
            },
            logSummary: {
                totalLogErrors: logs.length,
                successfulQuery: successfulQuery || null, // Save which query worked
                errorsByType: logErrorsByTypeArray,
                errorsByMessage: logErrorsByMessageArray.slice(0, 20) // Top 20 messages
            },
            oomSummary: {
                totalOOMEvents: oomEvents.length,
                oomEventDetails: oomEventDetails
            },
            traceErrorsByResource: errorsByResource,
            traceErrorsByType: errorsByType,
            logErrorDetails: logErrorDetails.slice(0, 100), // First 100 log errors
            traceTimeSeries: errorCountData.map(([timestamp, value]) => ({
                timestamp: new Date(timestamp).toISOString(),
                errors: value || 0
            }))
        };

        // Save to file
        const fileName = `./reports/${service}_error_metrics.json`;
        fs.writeFileSync(fileName, JSON.stringify(result, null, 2));

        console.log('✅ Error Metrics Summary:');
        console.log(`   📊 Trace Errors: ${result.traceSummary.totalErrors}`);
        console.log(`   📊 Log Errors: ${result.logSummary.totalLogErrors}`);
        console.log(`   📊 OOM Events: ${result.oomSummary.totalOOMEvents}`);
        console.log(`   📊 Total Requests: ${result.traceSummary.totalRequests}`);
        console.log(`   📊 Trace Error Rate: ${result.traceSummary.errorPercentage.toFixed(2)}%`);

        if (result.oomSummary.totalOOMEvents > 0) {
            console.log(`\n🚨 OOM Events:`);
            result.oomSummary.oomEventDetails.forEach((event, idx) => {
                console.log(`   ${idx + 1}. [${event.timestamp}] ${event.title}`);
                if (event.host) console.log(`      Host: ${event.host}`);
            });
        }

        console.log(`\n📋 Log Errors by Type:`);
        result.logSummary.errorsByType.forEach((error, idx) => {
            console.log(`   ${idx + 1}. ${error.errorType}: ${error.errorCount} errors`);
        });

        console.log(`\n📋 Top Log Error Messages:`);
        result.logSummary.errorsByMessage.slice(0, 5).forEach((error, idx) => {
            console.log(`   ${idx + 1}. ${error.message.substring(0, 80)}... (${error.errorCount} occurrences)`);
        });

        if (result.traceErrorsByType.length > 0) {
            console.log(`\n📋 Trace Errors by Type:`);
            result.traceErrorsByType.forEach((error, idx) => {
                console.log(`   ${idx + 1}. ${error.errorType}: ${error.errorCount} errors`);
            });
        }

        if (result.traceErrorsByResource.length > 0) {
            console.log(`\n📋 Trace Errors by Resource:`);
            result.traceErrorsByResource.slice(0, 10).forEach((error, idx) => {
                console.log(`   ${idx + 1}. ${error.resource}: ${error.errorCount} errors`);
            });
        }

        console.log(`\n💾 Saved to: ${fileName}\n`);

        return result;

    } catch (error) {
        console.error('❌ Error fetching error metrics:', error.response?.data || error.message);
        throw error;
    }
};

// Parse command line arguments
const args = process.argv.slice(2);
const fromIndex = args.indexOf('--from');
const toIndex = args.indexOf('--to');
const serviceIndex = args.indexOf('--service');

if (fromIndex === -1 || toIndex === -1 || serviceIndex === -1) {
    console.log('Usage: node fetch-error-metrics.js --from "Jan 13, 1:25 pm" --to "Jan 13, 1:56 pm" --service "stardust-closing-requirements-service"');
    process.exit(1);
}

const from = args[fromIndex + 1];
const to = args[toIndex + 1];
let service = args[serviceIndex + 1];

// Clean up service name - remove trailing spaces, commas, and quotes
service = service.trim().replace(/[,\s]+$/, '').replace(/^["']|["']$/g, '');

console.log(`🔧 Cleaned service name: "${service}"`);

fetchErrorMetrics(service, from, to);
