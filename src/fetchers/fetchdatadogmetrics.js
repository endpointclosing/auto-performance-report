import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';
import { execSync } from 'child_process';

dotenv.config();

const httpsAgent = new https.Agent({  
  rejectUnauthorized: false
});

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;
const DD_SITE = process.env.DD_SITE || 'datadoghq.com';

// ==================== CONFIGURATION ====================
// Usage: node fetch_endpoint_table.js "Jan 9, 3:00 pm – Jan 9, 3:31 pm, stardust-task-service"

const args = process.argv.slice(2);
let SERVICE_NAME = '';
let ENVIRONMENT = 'staging';
let TIME_FROM = '';
let TIME_TO = '';
let TIME_FROM_ORIGINAL = '';
let TIME_TO_ORIGINAL = '';

// Check if first argument is a combined format: "Jan 9, 3:00 pm – Jan 9, 3:31 pm, service-name"
if (args.length > 0 && !args[0].startsWith('--')) {
    const combined = args[0];
    
    // Split by comma to separate date range and service
    const parts = combined.split(',').map(p => p.trim());
    
    if (parts.length >= 2) {
        // Extract service name (last part)
        SERVICE_NAME = parts[parts.length - 1];
        
        // Join everything before the service name to handle commas in dates
        const dateRange = parts.slice(0, -1).join(',').trim();
        
        // Split by dash/en-dash to get from and to dates
        const dateParts = dateRange.split(/\s*[–-]\s*/);
        
        if (dateParts.length === 2) {
            TIME_FROM_ORIGINAL = dateParts[0].trim();
            TIME_TO_ORIGINAL = dateParts[1].trim();
            TIME_FROM = parseHumanDate(TIME_FROM_ORIGINAL);
            TIME_TO = parseHumanDate(TIME_TO_ORIGINAL);
        }
    }
} else {
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--service' && args[i + 1]) {
            SERVICE_NAME = args[i + 1];
            i++;
        } else if (args[i] === '--env' && args[i + 1]) {
            ENVIRONMENT = args[i + 1];
            i++;
        } else if (args[i] === '--from' && args[i + 1]) {
            TIME_FROM_ORIGINAL = args[i + 1];
            TIME_FROM = parseHumanDate(TIME_FROM_ORIGINAL);
            i++;
        } else if (args[i] === '--to' && args[i + 1]) {
            TIME_TO_ORIGINAL = args[i + 1];
            TIME_TO = parseHumanDate(TIME_TO_ORIGINAL);
            i++;
        }
    }
}

/**
 * Parse human-readable date to ISO format
 * Accepts: "Jan 9, 3:00 pm" or ISO format
 */
function parseHumanDate(dateStr) {
    if (dateStr.includes('T')) return dateStr;
    
    const currentYear = new Date().getFullYear();
    let hours = 0, minutes = 0;
    
    const timeMatch = dateStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
    if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
        const meridiem = timeMatch[3]?.toLowerCase();
        
        if (meridiem === 'pm' && hours !== 12) hours += 12;
        else if (meridiem === 'am' && hours === 12) hours = 0;
    }
    
    const dateMatch = dateStr.match(/([A-Za-z]{3})\s+(\d{1,2})/);
    if (dateMatch) {
        const monthMap = {
            'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
            'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
            'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
        };
        
        const monthNum = monthMap[dateMatch[1].toLowerCase()];
        const day = dateMatch[2].padStart(2, '0');
        const hr = hours.toString().padStart(2, '0');
        const min = minutes.toString().padStart(2, '0');
        
        return `${currentYear}-${monthNum}-${day}T${hr}:${min}:00`;
    }
    
    return dateStr;
}
// =======================================================

// Convert timestamps
const from = Math.floor(new Date(TIME_FROM).getTime() / 1000);
const to = Math.floor(new Date(TIME_TO).getTime() / 1000);

async function fetchMetric(query) {
    const url = `https://api.${DD_SITE}/api/v1/query`;
    
    try {
        const response = await axios.get(url, {
            params: {
                query: query,
                from: from,
                to: to
            },
            headers: {
                'DD-API-KEY': DD_API_KEY,
                'DD-APPLICATION-KEY': DD_APP_KEY,
                'Content-Type': 'application/json'
            },
            httpsAgent: httpsAgent
        });

        return response.data;
    } catch (error) {
        console.error(`❌ Error fetching: ${query}`);
        console.error('Error:', error.response?.data || error.message);
        return null;
    }
}

function extractByResource(data, aggregationType = 'avg') {
    if (!data?.series || data.series.length === 0) {
        return {};
    }

    const byResource = {};
    data.series.forEach(series => {
        let resourceName = 'unknown';
        
        if (series.scope) {
            const match = series.scope.match(/resource_name:([^,}]+)/);
            if (match) {
                resourceName = match[1];
            }
        }
        
        if (series.pointlist && series.pointlist.length > 0) {
            const values = series.pointlist.map(p => p[1]).filter(v => v !== null && v !== undefined);
            
            if (values.length === 0) return;
            
            let result;
            if (aggregationType === 'sum') {
                result = values.reduce((a, b) => a + b, 0);
            } else if (aggregationType === 'p95') {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.95);
    result = sorted[index] * 1000;
} else if (aggregationType === 'p99') {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * 0.99);
    result = sorted[index] * 1000;
} else if (aggregationType === 'rate') {
                result = values.reduce((a, b) => a + b, 0) / values.length;
            } else {
                result = values.reduce((a, b) => a + b, 0) / values.length;
            }
            
            byResource[resourceName] = result;
        }
    });

    return byResource;
}

async function fetchEndpointMetricsTable() {
    console.log(`📊 Fetching ${SERVICE_NAME} Metrics for Each Endpoint`);
    console.log(`⏰ Time Range: ${TIME_FROM} to ${TIME_TO}`);
    console.log(`🏷️  Service: ${SERVICE_NAME}, Environment: ${ENVIRONMENT}\n`);

    // Fetch all metrics with resource_name breakdown
    // Use service-specific trace queries
    let queries;
    
    if (SERVICE_NAME === 'operator-agent-service' || SERVICE_NAME === 'order-service') {
        // FastAPI-based queries for operator-agent-service and order-service
        queries = {
            requests: `sum:trace.fastapi.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_count()`,
            rate: `sum:trace.fastapi.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_rate()`,
            p95_latency: `p95:trace.fastapi.request{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name,service}`,
            p99_latency: `p99:trace.fastapi.request{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name,service}`,
            errors: `sum:trace.fastapi.request.errors{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_count()`,
        };
    } else {
        // Express-based queries for other services
        queries = {
            requests: `sum:trace.express.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_count()`,
            rate: `sum:trace.express.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_rate()`,
            p95_latency: `p95:trace.express.request{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name,service}`,
            p99_latency: `p99:trace.express.request{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name,service}`,
            errors: `sum:trace.express.request.errors{env:${ENVIRONMENT},service:${SERVICE_NAME}} by {resource_name}.as_count()`,
        };
    }

    // Separate service-level queries for combined timeline charts
    let serviceQueries;
    
    if (SERVICE_NAME === 'operator-agent-service' || SERVICE_NAME === 'order-service') {
        // FastAPI-based service-level queries - exact format as specified by user
        serviceQueries = {
            p95_service: `p95:trace.fastapi.request{env:${ENVIRONMENT},service:${SERVICE_NAME}}`,
            rate_service: `autosmooth(sum:trace.fastapi.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}}.as_rate())`
        };
    } else {
        // Express-based service-level queries
        serviceQueries = {
            p95_service: `p95:trace.express.request{service:${SERVICE_NAME},env:${ENVIRONMENT}}`,
            rate_service: `autosmooth(sum:trace.express.request.hits{env:${ENVIRONMENT},service:${SERVICE_NAME}}.as_rate())`
        };
    }

    console.log('Fetching metrics from Datadog...\n');
    const results = {};

    for (const [name, query] of Object.entries(queries)) {
        console.log(`📈 Fetching ${name}...`);
        const data = await fetchMetric(query);
        results[name] = data;
        
        if (data?.series) {
            console.log(`  ✅ Got ${data.series.length} series\n`);
        } else {
            console.log(`  ⚠️  No data\n`);
        }
    }

    // Fetch service-level queries for combined charts
    console.log('📈 Fetching service-level metrics for combined charts...\n');
    const serviceResults = {};
    
    for (const [name, query] of Object.entries(serviceQueries)) {
        console.log(`📈 Fetching ${name}...`);
        try {
            const response = await axios.get(`https://api.${DD_SITE}/api/v1/query`, {
                params: {
                    query: query,
                    from: from,
                    to: to
                },
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY,
                    'Content-Type': 'application/json'
                },
                httpsAgent: httpsAgent
            });
            
            serviceResults[name] = response.data;
            
            if (response.data?.series) {
                console.log(`  ✅ Got ${response.data.series.length} series\n`);
            } else {
                console.log(`  ⚠️  No data\n`);
            }
        } catch (error) {
            console.error(`❌ Error fetching ${name}:`, error.response?.data || error.message);
            serviceResults[name] = null;
        }
    }

    // Extract data by resource (endpoint)
    const requestsByResource = extractByResource(results.requests, 'sum');
    const rateByResource = extractByResource(results.rate, 'rate');
    const p95ByResource = extractByResource(results.p95_latency, 'p95');
    const p99ByResource = extractByResource(results.p99_latency, 'p99');
    const errorsByResource = extractByResource(results.errors, 'sum');

    // Get all unique endpoints
    const allEndpoints = new Set([
        ...Object.keys(requestsByResource),
        ...Object.keys(rateByResource),
        ...Object.keys(p95ByResource),
        ...Object.keys(p99ByResource),
        ...Object.keys(errorsByResource)
    ]);

    // Build table data
    const tableData = [];
    const totalTimeSeconds = to - from; // Total time window in seconds
    
    allEndpoints.forEach(endpoint => {
        const requests = requestsByResource[endpoint] || 0;
        const errorCount = errorsByResource[endpoint] || 0;
        const errorRate = requests > 0 ? ((errorCount / requests) * 100).toFixed(2) : '0.00';
        
        // Calculate rate as total requests / total time window
        const actualRate = totalTimeSeconds > 0 ? requests / totalTimeSeconds : 0;

        tableData.push({
            resource_name: endpoint,
            service: SERVICE_NAME,
            requests: requests.toFixed(0),
            p95_latency: p95ByResource[endpoint] ? `${p95ByResource[endpoint].toFixed(1)} ms` : 'N/A',
            p99_latency: p99ByResource[endpoint] ? `${p99ByResource[endpoint].toFixed(1)} ms` : 'N/A',
            rate: `${actualRate.toFixed(2)} hits/s`,
            errors: errorCount > 0 ? errorCount.toFixed(0) : '—',
            error_rate: errorRate
        });
    });

    // Display table
    console.log('\n' + '═'.repeat(150));
    console.log(`📊 ${SERVICE_NAME.toUpperCase()} - ENDPOINTS METRICS`);
    console.log('═'.repeat(150));
    console.log('\n');

    if (tableData.length === 0) {
        console.log('⚠️  No data found for the specified time range.');
    } else {
        console.log(
            'RESOURCE_NAME'.padEnd(40) + 
            'SERVICE'.padEnd(30) + 
            'REQUESTS'.padEnd(15) + 
            'P95 LATENCY'.padEnd(15) + 
            'P99 LATENCY'.padEnd(15) + 
            'RATE'.padEnd(15) + 
            'ERRORS'.padEnd(10) + 
            'ERROR RATE'
        );
        console.log('─'.repeat(150));

        tableData.forEach(row => {
            console.log(
                row.resource_name.padEnd(40) +
                row.service.padEnd(30) +
                row.requests.padEnd(15) +
                row.p95_latency.padEnd(15) +
                row.p99_latency.padEnd(15) +
                row.rate.padEnd(15) +
                row.errors.padEnd(10) +
                row.error_rate
            );
        });
    }

    console.log('\n' + '═'.repeat(150) + '\n');

    // Fetch real time series P95 data
    console.log('\n📈 Fetching real P95 time series data...');
    const timeSeriesData = await fetchTimeSeriesP95Data(from, to, Array.from(allEndpoints));
    
    // Fetch request rate time series
    console.log('\n📊 Fetching request rate time series data...');
    const rateTimeSeriesData = await fetchTimeSeriesRateData(from, to, Array.from(allEndpoints));

    // Save results
    const output = {
        timeRange: {
            from: TIME_FROM,
            to: TIME_TO,
            from_unix: from,
            to_unix: to
        },
        service: SERVICE_NAME,
        environment: ENVIRONMENT,
        metrics: tableData,
        timeSeries: timeSeriesData,
        rateTimeSeries: rateTimeSeriesData,
        serviceMetrics: {
            p95_service: serviceResults.p95_service,
            rate_service: serviceResults.rate_service
        },
        rawData: results
    };

    const outputPath = `./reports/${SERVICE_NAME}_endpoint_metrics_table.json`;
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`💾 Saved detailed results to: ${outputPath}\n`);

    return output;
}

// Fetch real time series P95 data for endpoints
async function fetchTimeSeriesP95Data(from, to, endpoints) {
    const timeSeriesData = {};
    
    for (const endpoint of endpoints.slice(0, 10)) { // Get all 10 endpoints
        try {
            const tracePattern = (SERVICE_NAME === 'operator-agent-service' || SERVICE_NAME === 'order-service') ? 'trace.fastapi.request' : 'trace.express.request';
            const query = `p95:${tracePattern}{env:${ENVIRONMENT},service:${SERVICE_NAME},resource_name:${endpoint}}`;
            
            const url = `https://api.${DD_SITE}/api/v1/query`;
            const params = {
                query: query,
                from: from,
                to: to
            };
            
            const response = await axios.get(url, {
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                params: params,
                httpsAgent
            });
            
            if (response.data && response.data.series && response.data.series.length > 0) {
                const series = response.data.series[0];
                if (series.pointlist && series.pointlist.length > 0) {
                    timeSeriesData[endpoint] = series.pointlist.map(point => ({
                        timestamp: point[0], // Unix timestamp in milliseconds
                        value: point[1] ? parseFloat((point[1] * 1000).toFixed(1)) : 0 // Convert to milliseconds
                    }));
                    
                    console.log(`  ✅ ${endpoint}: ${timeSeriesData[endpoint].length} data points`);
                } else {
                    timeSeriesData[endpoint] = [];
                }
            } else {
                timeSeriesData[endpoint] = [];
            }
            
            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.error(`  ❌ Error fetching ${endpoint}:`, error.message);
            timeSeriesData[endpoint] = [];
        }
    }
    
    return timeSeriesData;
}

// Fetch request rate time series data for endpoints
async function fetchTimeSeriesRateData(from, to, endpoints) {
    const rateTimeSeriesData = {};
    
    for (const endpoint of endpoints.slice(0, 10)) { // Get all 10 endpoints
        try {
            const tracePattern = (SERVICE_NAME === 'operator-agent-service' || SERVICE_NAME === 'order-service') ? 'trace.fastapi.request.hits' : 'trace.express.request.hits';
            const query = `sum:${tracePattern}{env:${ENVIRONMENT},service:${SERVICE_NAME},resource_name:${endpoint}}.as_rate()`;
            
            const url = `https://api.${DD_SITE}/api/v1/query`;
            const params = {
                query: query,
                from: from,
                to: to
            };
            
            const response = await axios.get(url, {
                headers: {
                    'DD-API-KEY': DD_API_KEY,
                    'DD-APPLICATION-KEY': DD_APP_KEY
                },
                params: params,
                httpsAgent
            });
            
            if (response.data && response.data.series && response.data.series.length > 0) {
                const series = response.data.series[0];
                if (series.pointlist && series.pointlist.length > 0) {
                    rateTimeSeriesData[endpoint] = series.pointlist.map(point => ({
                        timestamp: point[0], // Unix timestamp in milliseconds
                        value: point[1] ? parseFloat(point[1].toFixed(2)) : 0 // Request rate in hits/s
                    }));
                    
                    console.log(`  ✅ ${endpoint}: ${rateTimeSeriesData[endpoint].length} rate data points`);
                } else {
                    rateTimeSeriesData[endpoint] = [];
                }
            } else {
                rateTimeSeriesData[endpoint] = [];
            }
            
            // Delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
            
        } catch (error) {
            console.error(`  ❌ Error fetching rate for ${endpoint}:`, error.message);
            rateTimeSeriesData[endpoint] = [];
        }
    }
    
    return rateTimeSeriesData;
}

// Run if executed directly
async function main() {
    try {
        // Fetch endpoint metrics
        await fetchEndpointMetricsTable();
        
        // Automatically fetch container metrics
        console.log('\n📦 Fetching container metrics...');
        try {
            const containerCmd = `node src/fetchers/fetch-container-metrics.js --from "${TIME_FROM_ORIGINAL}" --to "${TIME_TO_ORIGINAL}" --service "${SERVICE_NAME}"`;
            execSync(containerCmd, { stdio: 'inherit' });
        } catch (error) {
            console.warn('⚠️  Warning: Could not fetch container metrics:', error.message);
        }
        
        // Automatically fetch error metrics
        console.log('\n⚠️  Fetching error metrics...');
        try {
            const errorCmd = `node src/fetchers/fetch-error-metrics.js --from "${TIME_FROM_ORIGINAL}" --to "${TIME_TO_ORIGINAL}" --service "${SERVICE_NAME}"`;
            execSync(errorCmd, { stdio: 'inherit' });
        } catch (error) {
            console.warn('⚠️  Warning: Could not fetch error metrics:', error.message);
        }
        
        console.log('\n✅ All metrics fetched successfully!');
        console.log('📝 Next step: Run "node confluence-uploader.js" to generate and upload the report');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();

export { fetchEndpointMetricsTable };
