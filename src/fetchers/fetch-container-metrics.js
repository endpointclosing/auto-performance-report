import axios from 'axios';
import https from 'https';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const DD_API_KEY = process.env.DD_API_KEY;
const DD_APP_KEY = process.env.DD_APP_KEY;
const DD_SITE = process.env.DD_SITE || 'datadoghq.com';

const args = process.argv.slice(2);
let SERVICE_NAME = '';
let ENVIRONMENT = 'staging';
let FROM_TIME = null;
let TO_TIME = null;

function parseDateTime(dateTimeStr) {
    // Parse formats like "Jan 3, 2:37 pm"
    const now = new Date();
    const currentYear = now.getFullYear();

    // Try parsing with current year
    let parsed = new Date(`${dateTimeStr}, ${currentYear}`);

    // If that didn't work, try a different format
    if (isNaN(parsed.getTime())) {
        parsed = new Date(dateTimeStr);
    }

    if (isNaN(parsed.getTime())) {
        throw new Error(`Invalid date format: ${dateTimeStr}`);
    }

    return Math.floor(parsed.getTime() / 1000);
}

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--service' && args[i + 1]) {
        SERVICE_NAME = args[i + 1];
        i++;
    } else if (args[i] === '--env' && args[i + 1]) {
        ENVIRONMENT = args[i + 1];
        i++;
    } else if (args[i] === '--from' && args[i + 1]) {
        FROM_TIME = args[i + 1];
        i++;
    } else if (args[i] === '--to' && args[i + 1]) {
        TO_TIME = args[i + 1];
        i++;
    }
}

if (!SERVICE_NAME) {
    console.error('❌ Missing required parameter: --service');
    console.log('\nUsage: node fetch-container-metrics.js --service "process-document-service" --env "staging" --from "Jan 3, 2:37 pm" --to "Jan 3, 3:09 pm"');
    process.exit(1);
}

let from, to;

if (FROM_TIME && TO_TIME) {
    from = parseDateTime(FROM_TIME);
    to = parseDateTime(TO_TIME);
} else {
    const now = Math.floor(Date.now() / 1000);
    from = now - 3600; // Last 1 hour
    to = now;
}

console.log(`📊 Fetching Container/Pod Metrics from Datadog`);
console.log(`🏷️  Service: ${SERVICE_NAME}, Environment: ${ENVIRONMENT}\n`);

/**
 * Fetch metric from Datadog
 */
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
                'DD-APPLICATION-KEY': DD_APP_KEY
            },
            httpsAgent
        });

        return response.data;
    } catch (error) {
        console.error(`Error fetching metric: ${error.message}`);
        return null;
    }
}

/**
 * Get container metrics
 */
async function getContainerMetrics() {
    console.log('📦 Fetching container metrics...\n');

    const queries = {
        runningContainers: `sum:kubernetes.containers.running{service:${SERVICE_NAME},env:${ENVIRONMENT}}`,
        cpu: `sum:kubernetes.cpu.usage.total{service:${SERVICE_NAME},env:${ENVIRONMENT}} by {pod_name}`,
        cpuLimit: `sum:kubernetes.cpu.limits{service:${SERVICE_NAME},env:${ENVIRONMENT}} by {pod_name}`,
        memoryPct: `sum:kubernetes.memory.usage_pct{kube_cluster_name:staging-usw2-jd56cpu4,kube_deployment:${SERVICE_NAME}} by {pod_name}`,
        pods: `sum:kubernetes.pods.running{service:${SERVICE_NAME},env:${ENVIRONMENT}}`,
        restarts: `sum:kubernetes.containers.restarts{service:${SERVICE_NAME},env:${ENVIRONMENT}} by {pod_name}`
    };

    const results = {};

    for (const [name, query] of Object.entries(queries)) {
        console.log(`  Fetching ${name}...`);
        const data = await fetchMetric(query);
        results[name] = data;

        if (data?.series) {
            console.log(`  ✅ Got ${data.series.length} series`);
        } else {
            console.log(`  ⚠️  No data`);
        }
    }

    return results;
}

/**
 * Process and display results
 */
function displayResults(results) {
    console.log('\n' + '═'.repeat(100));
    console.log('📊 CONTAINER/POD METRICS SUMMARY');
    console.log('═'.repeat(100));
    console.log();

    // Running containers
    if (results.runningContainers?.series?.[0]) {
        const series = results.runningContainers.series[0];
        const values = series.pointlist.map(p => p[1]).filter(v => v != null);
        const current = values[values.length - 1] || 0;
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

        console.log('🏃 Running Containers:');
        console.log(`   Current: ${Math.round(current)}`);
        console.log(`   Average: ${Math.round(avg)}`);
        console.log();
    }

    // Running pods
    if (results.pods?.series?.[0]) {
        const series = results.pods.series[0];
        const values = series.pointlist.map(p => p[1]).filter(v => v != null);
        const current = values[values.length - 1] || 0;
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

        console.log('📦 Running Pods:');
        console.log(`   Current: ${Math.round(current)}`);
        console.log(`   Average: ${Math.round(avg)}`);
        console.log();
    }

    // CPU usage by pod
    if (results.cpu?.series && results.cpu.series.length > 0) {
        console.log('💻 CPU Usage by Pod:');
        console.log(`${'POD NAME'.padEnd(60)} ${'AVG CPU'.padEnd(20)} ${'MAX CPU'.padEnd(20)}`);
        console.log('─'.repeat(100));

        results.cpu.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const max = Math.max(...values);

            console.log(`${podName.padEnd(60)} ${(avg / 1e9).toFixed(2).padEnd(20)} ${(max / 1e9).toFixed(2).padEnd(20)}`);
        });
        console.log();
    }

    // Memory usage by pod
    if (results.memoryPct?.series && results.memoryPct.series.length > 0) {
        console.log('💾 Memory Usage by Pod:');
        console.log(`${'POD NAME'.padEnd(60)} ${'AVG MEMORY (%)'.padEnd(20)} ${'MAX MEMORY (%)'.padEnd(20)}`);
        console.log('─'.repeat(100));

        results.memoryPct.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const max = Math.max(...values);

            console.log(`${podName.padEnd(60)} ${(avg * 100).toFixed(2).padEnd(20)} ${(max * 100).toFixed(2).padEnd(20)}`);
        });
        console.log();
    }

    // Container restarts
    if (results.restarts?.series && results.restarts.series.length > 0) {
        console.log('🔄 Container Restarts:');
        console.log(`${'POD NAME'.padEnd(60)} ${'RESTART COUNT'.padEnd(20)}`);
        console.log('─'.repeat(100));

        results.restarts.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const totalRestarts = Math.max(...values);

            console.log(`${podName.padEnd(60)} ${totalRestarts.toFixed(0).padEnd(20)}`);
        });
        console.log();
    }

    console.log('═'.repeat(100));
}

/**
 * Process metrics into structured format for report
 */
function processMetrics(results) {
    const summary = {
        runningContainers: { current: 0, average: 0 },
        runningPods: { current: 0, average: 0 }
    };

    const podMetrics = [];
    const timeSeries = { cpu: [], memory: [] };

    // Process running containers
    if (results.runningContainers?.series?.[0]) {
        const series = results.runningContainers.series[0];
        const values = series.pointlist.map(p => p[1]).filter(v => v != null);
        summary.runningContainers.current = Math.round(values[values.length - 1] || 0);
        summary.runningContainers.average = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
    }

    // Process running pods
    if (results.pods?.series?.[0]) {
        const series = results.pods.series[0];
        const values = series.pointlist.map(p => p[1]).filter(v => v != null);
        summary.runningPods.current = Math.round(values[values.length - 1] || 0);
        summary.runningPods.average = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
    }

    // Process CPU and Memory by pod
    const podMap = new Map();

    if (results.cpu?.series) {
        results.cpu.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const max = Math.max(...values);

            if (!podMap.has(podName)) {
                podMap.set(podName, { podName, avgCpu: 0, maxCpu: 0, avgCpuPct: 0, maxCpuPct: 0, avgMemory: 0, maxMemory: 0, avgMemoryPct: 0, maxMemoryPct: 0, restarts: 0, cpuLimit: 0, memoryLimit: 0 });
            }

            const pod = podMap.get(podName);
            pod.avgCpu = avg / 1e9; // Convert to cores
            pod.maxCpu = max / 1e9;

            // Add time series
            series.pointlist.forEach(point => {
                timeSeries.cpu.push({
                    timestamp: new Date(point[0]).toISOString(),
                    podName: podName,
                    value: point[1] / 1e9
                });
            });
        });
    }

    if (results.cpuLimit?.series) {
        results.cpuLimit.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const limit = values.reduce((sum, v) => sum + v, 0) / values.length;

            if (!podMap.has(podName)) {
                podMap.set(podName, { podName, avgCpu: 0, maxCpu: 0, avgCpuPct: 0, maxCpuPct: 0, avgMemory: 0, maxMemory: 0, avgMemoryPct: 0, maxMemoryPct: 0, restarts: 0, cpuLimit: 0, memoryLimit: 0 });
            }

            const pod = podMap.get(podName);
            pod.cpuLimit = limit; // Keep in nanocores for percentage calculation
        });
    }

    if (results.memoryPct?.series) {
        results.memoryPct.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
            const max = Math.max(...values);

            if (!podMap.has(podName)) {
                podMap.set(podName, { podName, avgCpu: 0, maxCpu: 0, avgCpuPct: 0, maxCpuPct: 0, avgMemory: 0, maxMemory: 0, avgMemoryPct: 0, maxMemoryPct: 0, restarts: 0, cpuLimit: 0, memoryLimit: 0 });
            }

            const pod = podMap.get(podName);
            // Since we're using usage_pct query, multiply by 100 for percentage display
            pod.avgMemoryPct = avg * 100;
            pod.maxMemoryPct = max * 100;

            // Add time series
            series.pointlist.forEach(point => {
                timeSeries.memory.push({
                    timestamp: new Date(point[0]).toISOString(),
                    podName: podName,
                    value: point[1] * 100 // Multiply by 100 for percentage
                });
            });
        });
    }

    if (results.memoryLimit?.series) {
        results.memoryLimit.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const limit = values.reduce((sum, v) => sum + v, 0) / values.length;

            if (!podMap.has(podName)) {
                podMap.set(podName, { podName, avgCpu: 0, maxCpu: 0, avgCpuPct: 0, maxCpuPct: 0, avgMemory: 0, maxMemory: 0, avgMemoryPct: 0, maxMemoryPct: 0, restarts: 0, cpuLimit: 0, memoryLimit: 0 });
            }

            const pod = podMap.get(podName);
            pod.memoryLimit = limit; // Keep in bytes for percentage calculation
        });
    }

    // Calculate percentages
    podMap.forEach(pod => {
        if (pod.cpuLimit > 0) {
            // CPU usage and limit are both in cores
            pod.avgCpuPct = (pod.avgCpu / pod.cpuLimit) * 100;
            pod.maxCpuPct = (pod.maxCpu / pod.cpuLimit) * 100;
        }
        if (pod.memoryLimit > 0) {
            // Memory usage in MB, limit in bytes
            pod.avgMemoryPct = ((pod.avgMemory * 1024 * 1024) / pod.memoryLimit) * 100;
            pod.maxMemoryPct = ((pod.maxMemory * 1024 * 1024) / pod.memoryLimit) * 100;
        }
    });

    if (results.restarts?.series) {
        results.restarts.series.forEach(series => {
            const podName = series.scope.match(/pod_name:([^,}]+)/)?.[1] || 'unknown';
            const values = series.pointlist.map(p => p[1]).filter(v => v != null);
            const totalRestarts = Math.max(...values);

            if (!podMap.has(podName)) {
                podMap.set(podName, { podName, avgCpu: 0, maxCpu: 0, avgMemory: 0, maxMemory: 0, restarts: 0 });
            }

            podMap.get(podName).restarts = totalRestarts;
        });
    }

    // Convert podMap to array
    podMap.forEach(pod => podMetrics.push(pod));

    return { summary, podMetrics, timeSeries };
}

/**
 * Main function
 */
async function main() {
    try {
        const results = await getContainerMetrics();

        displayResults(results);

        const processed = processMetrics(results);

        // Save to JSON
        const outputData = {
            timestamp: new Date().toISOString(),
            service: SERVICE_NAME,
            environment: ENVIRONMENT,
            timeRange: {
                from: new Date(from * 1000).toISOString(),
                to: new Date(to * 1000).toISOString()
            },
            summary: processed.summary,
            podMetrics: processed.podMetrics,
            timeSeries: processed.timeSeries,
            rawMetrics: results
        };

        const outputFile = `./reports/${SERVICE_NAME}_container_metrics.json`;
        fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));

        console.log(`\n💾 Saved results to: ${outputFile}`);
        console.log(`\n💡 Tip: You can integrate this data into your Confluence reports!`);

    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

main();
