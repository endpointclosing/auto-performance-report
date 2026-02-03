import fs from 'fs';
import path from 'path';

console.log('📊 Generating Full Interactive HTML Report...\n');

// Auto-detect latest metrics file
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
    console.error('❌ No metrics files found in reports directory');
    process.exit(1);
}

const metricsFile = files[0].path;
console.log(`✅ Found latest file: ${files[0].name}\n`);

// Load the metrics data
const data = JSON.parse(fs.readFileSync(metricsFile, 'utf8'));

const colors = ['#632CA6', '#F84D8C', '#19A974', '#E8871E', '#3D4EB8', '#C93854', '#137CBD', '#00BF87', '#DB3737', '#8F398F'];

// Format date to "Jan 13, 1:25 pm" format
function formatDateTime(dateStr) {
    const date = new Date(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const day = date.getDate();
    let hours = date.getHours();
    const minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12 || 12;
    const minutesStr = minutes < 10 ? '0' + minutes : minutes;
    
    return `${month} ${day}, ${hours}:${minutesStr} ${ampm}`;
}

// Generate HTML content
let htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${data.service} - Interactive Performance Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@2.0.0/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: #f5f6f7;
            padding: 20px;
            color: #172B4D;
        }
        .container { max-width: 1400px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { 
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 8px 8px 0 0;
        }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .header p { opacity: 0.9; font-size: 14px; }
        .content { padding: 30px; }
        .section { margin-bottom: 40px; }
        .section h2 { 
            font-size: 20px; 
            margin-bottom: 20px;
            padding-bottom: 10px;
            border-bottom: 2px solid #E8E8E8;
            color: #172B4D;
        }
        .chart-container { 
            position: relative; 
            height: 400px;
            margin-bottom: 30px;
            background: #fafbfc;
            padding: 20px;
            border-radius: 6px;
            border: 1px solid #e8e8e8;
        }
        .endpoint-section {
            margin-bottom: 30px;
            border: 1px solid #e8e8e8;
            border-radius: 6px;
            overflow: hidden;
        }
        .endpoint-header {
            background: #f4f5f7;
            padding: 15px 20px;
            cursor: pointer;
            user-select: none;
            display: flex;
            justify-content: space-between;
            align-items: center;
            transition: background 0.2s;
        }
        .endpoint-header:hover { background: #ebecf0; }
        .endpoint-header h3 { font-size: 16px; color: #172B4D; }
        .endpoint-stats {
            display: flex;
            gap: 20px;
            font-size: 13px;
            color: #5E6C84;
        }
        .endpoint-stats span { font-weight: 600; color: #172B4D; }
        .endpoint-content {
            padding: 20px;
            display: none;
        }
        .endpoint-content.active { display: block; }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .stat-card {
            background: #f4f5f7;
            padding: 15px;
            border-radius: 6px;
            border-left: 3px solid #0052CC;
        }
        .stat-card label { 
            display: block;
            font-size: 12px;
            color: #5E6C84;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .stat-card value { 
            display: block;
            font-size: 20px;
            font-weight: 600;
            color: #172B4D;
        }
        .chart-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-top: 20px;
        }
        .chart-box {
            position: relative;
            height: 300px;
            background: #fafbfc;
            padding: 15px;
            border-radius: 6px;
            border: 1px solid #e8e8e8;
        }
        .chart-title {
            font-size: 14px;
            font-weight: 600;
            color: #172B4D;
            margin-bottom: 10px;
        }
        .toggle-icon {
            font-size: 20px;
            transition: transform 0.3s;
        }
        .toggle-icon.active { transform: rotate(180deg); }
        @media (max-width: 768px) {
            .chart-row { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 ${data.service} - Performance Report</h1>
            <p>📅 ${formatDateTime(data.timeRange.from)} – ${formatDateTime(data.timeRange.to)}</p>
            <p>🌐 Environment: ${data.environment.charAt(0).toUpperCase() + data.environment.slice(1)}</p>
        </div>
        
        <div class="content">
            <!-- Scatter Plot Section -->
            <div class="section">
                <h2>📊 Request Rate vs P95 Latency Correlation</h2>
                <div class="chart-container">
                    <canvas id="scatterChart"></canvas>
                </div>
            </div>
            
            <!-- Individual Endpoints -->
            <div class="section">
                <h2>📈 Individual Endpoint Analysis</h2>
                <p style="color: #5E6C84; margin-bottom: 20px; font-size: 14px;">
                    Click on any endpoint to expand and view interactive Rate and P95 time series charts
                </p>
`;

// Add endpoint sections
data.metrics.forEach((metric, index) => {
    const endpoint = metric.resource_name;
    const color = colors[index % colors.length];
    const timeSeries = data.timeSeries[endpoint] || [];
    const rateTimeSeries = data.rateTimeSeries?.[endpoint] || [];
    
    if (timeSeries.length === 0) return;
    
    const values = timeSeries.map(d => d.value);
    const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
    const rate = parseFloat(metric.rate.split(' ')[0]);
    
    htmlContent += `
                <div class="endpoint-section">
                    <div class="endpoint-header" onclick="toggleEndpoint(${index})">
                        <div>
                            <h3>${index + 1}. ${endpoint.replace(/_/g, ' ')}</h3>
                        </div>
                        <div style="display: flex; align-items: center; gap: 30px;">
                            <div class="endpoint-stats">
                                <div>Rate: <span>${rate.toFixed(2)} req/s</span></div>
                                <div>P95: <span>${metric.p95_latency}</span></div>
                                <div>Requests: <span>${metric.requests}</span></div>
                            </div>
                            <span class="toggle-icon" id="toggle-${index}">▼</span>
                        </div>
                    </div>
                    <div class="endpoint-content" id="content-${index}">
                        <div class="stats-grid">
                            <div class="stat-card">
                                <label>Request Rate</label>
                                <value>${metric.rate}</value>
                            </div>
                            <div class="stat-card">
                                <label>Total Requests</label>
                                <value>${metric.requests}</value>
                            </div>
                            <div class="stat-card">
                                <label>P95 Latency</label>
                                <value>${metric.p95_latency}</value>
                            </div>
                            <div class="stat-card">
                                <label>P99 Latency</label>
                                <value>${metric.p99_latency}</value>
                            </div>
                        </div>
                        
                        <div class="chart-row">
                            <div class="chart-box">
                                <div class="chart-title">📊 Request Rate Over Time</div>
                                <canvas id="rateChart-${index}"></canvas>
                            </div>
                            <div class="chart-box">
                                <div class="chart-title">📈 P95 Latency Over Time</div>
                                <canvas id="p95Chart-${index}"></canvas>
                            </div>
                        </div>
                    </div>
                </div>
    `;
});

htmlContent += `
            </div>
        </div>
    </div>
    
    <script>
        // Toggle endpoint sections
        function toggleEndpoint(index) {
            const content = document.getElementById('content-' + index);
            const icon = document.getElementById('toggle-' + index);
            
            if (content.classList.contains('active')) {
                content.classList.remove('active');
                icon.classList.remove('active');
            } else {
                content.classList.add('active');
                icon.classList.add('active');
                
                // Initialize charts when opened for the first time
                if (!content.dataset.initialized) {
                    initializeEndpointCharts(index);
                    content.dataset.initialized = 'true';
                }
            }
        }
        
        // Scatter plot data
        const scatterData = ${JSON.stringify(data.metrics.map((m, i) => ({
            x: parseFloat(m.rate.split(' ')[0]),
            y: parseFloat(m.p95_latency.split(' ')[0]),
            label: m.resource_name,
            color: colors[i % colors.length]
        })))};
        
        const colors = ${JSON.stringify(colors)};
        
        // Create scatter plot
        const scatterCtx = document.getElementById('scatterChart').getContext('2d');
        const scatterChart = new Chart(scatterCtx, {
            type: 'scatter',
            data: {
                datasets: scatterData.map((point, idx) => ({
                    label: point.label.replace(/_/g, ' '),
                    data: [{ x: point.x, y: point.y }],
                    backgroundColor: point.color,
                    borderColor: point.color,
                    borderWidth: 2,
                    pointRadius: 8,
                    pointHoverRadius: 12
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: 'Request Rate vs P95 Latency',
                        font: { size: 18, weight: 'bold' }
                    },
                    legend: {
                        display: true,
                        position: 'right',
                        labels: { font: { size: 11 }, boxWidth: 12, padding: 10 },
                        onClick: function(e, legendItem, legend) {
                            const index = legendItem.datasetIndex;
                            const chart = legend.chart;
                            
                            // Check if this is the only visible dataset
                            const visibleCount = chart.data.datasets.filter((ds, i) => chart.isDatasetVisible(i)).length;
                            const isOnlyOneVisible = visibleCount === 1 && chart.isDatasetVisible(index);
                            
                            if (isOnlyOneVisible) {
                                // If only this one is visible, show all
                                chart.data.datasets.forEach((dataset, i) => {
                                    chart.show(i);
                                });
                            } else {
                                // Hide all others, show only this one
                                chart.data.datasets.forEach((dataset, i) => {
                                    if (i === index) {
                                        chart.show(i);
                                    } else {
                                        chart.hide(i);
                                    }
                                });
                            }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0,0,0,0.9)',
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                return context.dataset.label + ': ' + context.parsed.x.toFixed(2) + ' req/s, P95: ' + context.parsed.y.toFixed(1) + ' ms';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Request Rate (hits/s)', font: { size: 14, weight: '600' } },
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    },
                    y: {
                        title: { display: true, text: 'P95 Latency (ms)', font: { size: 14, weight: '600' } },
                        beginAtZero: true,
                        grid: { color: 'rgba(0,0,0,0.05)' }
                    }
                }
            }
        });
        
        // Initialize endpoint charts
        function initializeEndpointCharts(index) {
            const endpoints = ${JSON.stringify(data.metrics.map(m => m.resource_name))};
            const endpoint = endpoints[index];
            const timeSeries = ${JSON.stringify(data.timeSeries)};
            const rateTimeSeries = ${JSON.stringify(data.rateTimeSeries || {})};
            
            const p95Data = timeSeries[endpoint] || [];
            const rateData = rateTimeSeries[endpoint] || [];
            
            const color = colors[index % colors.length];
            
            // Rate chart
            if (rateData.length > 0) {
                const rateCtx = document.getElementById('rateChart-' + index).getContext('2d');
                new Chart(rateCtx, {
                    type: 'line',
                    data: {
                        datasets: [{
                            label: 'Request Rate (hits/s)',
                            data: rateData.map(p => ({ x: p.timestamp, y: p.value })),
                            borderColor: '#E8871E',
                            backgroundColor: 'rgba(232, 135, 30, 0.1)',
                            borderWidth: 2,
                            pointRadius: 1,
                            pointHoverRadius: 5,
                            fill: true,
                            tension: 0.1
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        interaction: { mode: 'index', intersect: false },
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: 'rgba(0,0,0,0.9)',
                                callbacks: {
                                    label: function(context) {
                                        return 'Rate: ' + context.parsed.y.toFixed(2) + ' hits/s';
                                    }
                                }
                            }
                        },
                        scales: {
                            x: {
                                type: 'time',
                                time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
                                title: { display: true, text: 'Time' },
                                grid: { color: 'rgba(0,0,0,0.05)' }
                            },
                            y: {
                                beginAtZero: true,
                                title: { display: true, text: 'Request Rate (hits/s)' },
                                grid: { color: 'rgba(0,0,0,0.05)' }
                            }
                        }
                    }
                });
            }
            
            // P95 chart
            const p95Ctx = document.getElementById('p95Chart-' + index).getContext('2d');
            new Chart(p95Ctx, {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'P95 Latency (ms)',
                        data: p95Data.map(p => ({ x: p.timestamp, y: p.value })),
                        borderColor: color,
                        backgroundColor: color + '20',
                        borderWidth: 2,
                        pointRadius: 1,
                        pointHoverRadius: 5,
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(0,0,0,0.9)',
                            callbacks: {
                                label: function(context) {
                                    return 'P95: ' + context.parsed.y.toFixed(1) + ' ms';
                                }
                            }
                        }
                    },
                    scales: {
                        x: {
                            type: 'time',
                            time: { unit: 'minute', displayFormats: { minute: 'HH:mm' } },
                            title: { display: true, text: 'Time' },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'P95 Latency (ms)' },
                            grid: { color: 'rgba(0,0,0,0.05)' }
                        }
                    }
                }
            });
        }
    </script>
</body>
</html>`;

// Save the HTML file
const outputPath = './complete-interactive-report.html';
fs.writeFileSync(outputPath, htmlContent);

console.log(`✅ Interactive HTML report generated!`);
console.log(`📁 File: ${outputPath}`);
console.log(`\n💡 Open this file in your browser for full interactive charts!`);
console.log(`📎 You can share this file or host it on a web server for access from Confluence.`);
